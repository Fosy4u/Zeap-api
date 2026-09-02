
const { orderStatusEnums } = require("../helpers/constants");
const { getAuthUser } = require("../middleware/firebaseUserAuth");
const BasketModel = require("../models/basket");
const DeliveryAddressModel = require("../models/deliveryAddresses");
const OrderModel = require("../models/order");
const ProductOrderModel = require("../models/productOrder");
const ProductModel = require("../models/products");
const ShopModel = require("../models/shop");
const {
  currencyCoversion,
  addWeekDays,
  getExpectedStandardDeliveryDate,
  getExpectedExpressDeliveryDate,
  getExpectedVendorCompletionDate,
} = require("../helpers/utils");
const { default: mongoose } = require("mongoose");
const {
  addNotification,
  sendPushAllAdmins,
  notifyShop,
  sendPushOneDevice,
  sendPushMultipleDevice,
} = require("./notification");
const NotificationModel = require("../models/notification");
const generatePdf = require("../helpers/pdf");
const { ENV } = require("../config");
const { first } = require("lodash");
const url =
  ENV === "prod"
    ? process.env.DOC_DOWNLOAD_URL_PROD
    : process.env.DOC_DOWNLOAD_URL_DEV;

function getRandomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

const generateUniqueOrderId = async () => {
  let orderId;
  let found = true;

  do {
    const randomVal = getRandomInt(1000000, 9999999);
    orderId = `${randomVal}`;
    const exist = await OrderModel.findOne(
      {
        orderId,
      },
      { lean: true }
    );

    if (exist) {
      found = true;
    } else {
      found = false;
    }
  } while (found);

  return orderId.toString();
};

const buildProductOrders = async (
  order,
  basketItems,
  currency,
  deliveryMethod,
  deliveryDetails
) => {
  const productOrders = [];
  const orderId = order.orderId;

  const promises = basketItems.map(async (item, index) => {
    const product = await ProductModel.findOne({
      _id: item.product,
    }).lean();
    if (!product) {
      return;
    }
    const shop = product.shop;

    const itemNo = index + 1;
    const quantity = item.quantity;
    const sku = item.sku;
    const orderedVariations = product?.variations.find(
      (variation) => variation.sku === sku
    );
    const size = orderedVariations?.size;
    const color = orderedVariations?.colorValue;
    const images =
      product?.colors
        .find((col) => col.value == color)
        ?.images.map((image) => {
          return { link: image.link, name: image.name };
        }) || [];

    const bespokeColor = item.bespokeColor;
    const bodyMeasurements = item.bodyMeasurements;
    const bespokeInstruction = item.bespokeInstruction;
    const status = {
      name: "placed",
      value: "order placed",
    };
    const promo = product.promo;
    const variation = product.variations.find((v) => v.sku === sku);
    const amountDue = (variation?.discount || variation.price) * quantity;
    const usdValue = await currencyCoversion(amountDue, "USD");
    const gbpValue = await currencyCoversion(amountDue, "GBP");
    const amount = [
      {
        currency: "NGN",
        value: amountDue,
      },
    ];
    if (currency === "USD") {
      amount.push({
        currency: "USD",
        value: usdValue,
      });
    }
    if (currency === "GBP") {
      amount.push({
        currency: "GBP",
        value: gbpValue,
      });
    }
    const shopRevenue = {
      currency: "NGN",
      status: "pending",
      // value is 75% of the amount due
      value: amountDue * 0.75,
    };
    let expectedDeliveryDate = null;

    const createdAt = new Date();
    const productType = product.productType;
    const country = deliveryDetails?.country || "Nigeria";
    const expectedDeliveryDays =
      deliveryMethod === "express"
        ? getExpectedStandardDeliveryDate(productType, country)
        : getExpectedExpressDeliveryDate(productType, country);
    expectedDeliveryDate = {
      min: addWeekDays(createdAt, expectedDeliveryDays.min),
      max: addWeekDays(createdAt, expectedDeliveryDays.max),
    };
    const expectedVendorCompletionDays =
      getExpectedVendorCompletionDate(productType);
    const expectedVendorCompletionDate = {
      min: addWeekDays(createdAt, expectedVendorCompletionDays.min),
      max: addWeekDays(createdAt, expectedVendorCompletionDays.max),
    };
    const productOrder = new ProductOrderModel({
      order: order._id,
      orderId,
      itemNo,
      shop,
      product: item.product._id,
      quantity,
      sku,
      bespokeColor,
      bespokeInstruction,
      bodyMeasurements,
      status,
      amount,
      promo,
      color,
      images,
      size,
      shopRevenue,
      deliveryMethod,
      user: order.user,
      expectedDeliveryDate,
      expectedVendorCompletionDate,
    });

    const savedProductOrder = await productOrder.save();
    //handle shop notifications
    if (savedProductOrder && shop) {
      const title = "New Order";
      const body = `You have a new order with order ID - ${orderId} and item number - ${itemNo}`;
      const image = savedProductOrder?.images[0]?.link || null;
      const notifyShopParam = { shop_id: shop.toString(), title, body, image };
      const notify = await notifyShop(notifyShopParam);
    }
    productOrders.push(savedProductOrder._id);
  });

  await Promise.all(promises);
  return productOrders;
};
const updateVariationQuantity = async (basketItems, action) => {
  return new Promise(async (resolve) => {
    basketItems.forEach(async (item) => {
      const product = await ProductModel.findOne({
        _id: item.product._id,
      }).lean();
      if (!product) {
        return;
      }

      const variations = product.variations;
      const variation = variations.find(
        (variation) => variation.sku === item.sku
      );
      if (!variation) {
        return;
      }
      const isBespoke = variation?.bespoke?.isBespoke
        ? variation.bespoke.isBespoke
        : false;
      if (isBespoke) {
        return;
      }
      const quantity = item.quantity;
      const newQuantity =
        action === "add"
          ? variation.quantity + quantity
          : variation.quantity - quantity;
      await ProductModel.findOneAndUpdate(
        {
          _id: item.product._id,
          "variations.sku": item.sku,
        },
        {
          $set: {
            "variations.$.quantity": newQuantity,
          },
        }
      );
    });
    resolve(true);
  });
};

const createOrder = async (param) => {
  const { payment, user, gainedPoints } = param;
  const deliveryMethod = payment?.deliveryMethod;
  const basket = await BasketModel.findOne({
    _id: payment.basket,
  }).lean();
  if (!basket) {
    return {
      error: "Payment successful but basket not found. Please contact support",
    };
  }
  const deliveryDetails = basket.deliveryDetails;
  if (!deliveryDetails) {
    return {
      error:
        "Payment successful but delivery details not found. Please contact support",
    };
  }
  const basketItems = basket.basketItems;

  const orderId = await generateUniqueOrderId();
  const order = new OrderModel({
    orderId,
    user: user,
    basket: basket?._id,
    deliveryDetails,
    payment: payment?._id,
    gainedPoints,
  });

  const savedOrder = await order.save();
  if (!savedOrder?._id) {
    return {
      error: "Payment successful but order not created. Please contact support",
    };
  }
  const currency = payment.currency;

  const productOrders = await buildProductOrders(
    savedOrder,
    basketItems,
    currency,
    deliveryMethod,
    deliveryDetails
  );
  if (!productOrders || productOrders.length === 0) {
    return {
      error:
        "Payment successful but product orders not created. Please contact support",
    };
  }

  const updateOrder = await OrderModel.findOneAndUpdate(
    { _id: savedOrder._id },
    { productOrders },
    { new: true }
  );

  const updateVariation = await updateVariationQuantity(
    basketItems,
    "subtract"
  );
  if (updateOrder && updateVariation) {
    // delete basket
    await BasketModel.findOneAndDelete({ _id: basket._id });
  }
  const title = "Order Placed";
  const body = `Your order with order ID ${orderId} has been placed successfully`;
  const image = null;
  const pushAllAdmins = await sendPushAllAdmins(title, body, image);
  const userNotification = await NotificationModel.findOne({
    user,
  });
  const pushToken = userNotification?.pushToken || [];
  if (pushToken?.length > 0) {
    const push = await sendPushMultipleDevice(pushToken, title, body, image);
  }
  const notificationParam = {
    title,
    body,
    image,
    isAdminPanel: false,
    user_id: user,
  };
  const addUserNotification = await addNotification(notificationParam);

  const addAdminNotification = await addNotification({
    ...notificationParam,
    isAdminPanel: true,
    user_id: null,
  });

  return {
    order: updateOrder,
    productOrders,
  };
};

const getProductOrderPercentage = (allocatedPercentage, productOrder) => {
  const status = orderStatusEnums?.find(
    (status) => status.value === productOrder?.status?.value
  );
  if (!status) return 0;
  // allocatedPercentage is the percentage of the item in the overall order
  const statusPercentage = status?.percentage || 0;
  const productOrderPercentage = (allocatedPercentage / 100) * statusPercentage;
  return productOrderPercentage;
};
const calcOrderProgress = (productOrders) => {
  const total = productOrders?.filter(
    (productOrder) => productOrder?.status?.value !== "order cancelled"
  ).length;
  return productOrders?.reduce((acc, productOrder) => {
    const allocatedPercentage = 100 / total;
    const productOrderPercentage = getProductOrderPercentage(
      allocatedPercentage,
      productOrder
    );
    return acc + productOrderPercentage;
  }, 0);
};
const getAuthBuyerOrders = async (req, res) => {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return res.status(400).send({ error: "User not found" });
    }
    const orders = await OrderModel.find({ user: authUser._id })
      .populate("productOrders")
      .populate("payment")
      // populate product inside productOrders
      .populate({
        path: "productOrders",
        populate: ["product"],
      })
      .lean();

    if (!orders) {
      return res.status(200).send({ data: [], message: "No orders found" });
    }
    orders.forEach((order) => {
      const progressValue = calcOrderProgress(order.productOrders);
      const progress = {
        value: progressValue,
        max: 100,
        min: 0,
      };
      order.progress = progress;
    });

    return res
      .status(200)
      .send({ data: orders.reverse(), message: "Orders fetched successfully" });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

const getAuthVendorProductOrders = async (req, res) => {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return res.status(400).send({ error: "User not found" });
    }
    const shop = await ShopModel.findOne({ shopId: authUser.shopId }).lean();
    if (!shop) {
      return res.status(400).send({ error: "Shop not found" });
    }
    const productOrders = await ProductOrderModel.find({ shop: shop._id })
      .populate("product")
      .populate("user")
      .lean();
    // sort by createdAt in descending order
    productOrders.sort((a, b) => b.createdAt - a.createdAt);
    return res.status(200).send({
      data: productOrders,
      message: "Product Orders fetched successfully",
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

const getOrders = async (req, res) => {
  try {
    const orders = await OrderModel.find(req.query)

      .populate("user")
      .populate("productOrders")
      .lean();
    if (!orders) {
      return res.status(200).send({ data: [], message: "No orders found" });
    }
    orders.forEach((order) => {
      const progressValue = calcOrderProgress(order.productOrders);
      const progress = {
        value: progressValue,
        max: 100,
        min: 0,
      };
      order.progress = progress;
    });
    // sort by createdAt in descending order
    orders.sort((a, b) => b.createdAt - a.createdAt);

    return res
      .status(200)
      .send({ data: orders, message: "Orders fetched successfully" });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};
const getOrder = async (req, res) => {
  try {
    const { order_id } = req.query;
    if (!order_id) {
      return res.status(400).send({ error: "required order_id" });
    }
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return res.status(400).send({ error: "User not found" });
    }

    const order = await OrderModel.findOne({ _id: order_id })
      .populate("productOrders")
      .populate("payment")
      .populate("user")
      .populate({
        path: "productOrders",
        populate: [
          { path: "product" },
          {
            path: "user",
          },
          {
            path: "shop",
          },
        ],
      })

      .lean();

    // const website_url = `${url}/${order_id}`;
    // console.log("website_url", website_url);
    // const pdf = await generatePdf({
    //   type: "url",
    //   website_url,
    // });
    const user = order.user;
    const isAdmin = authUser.superAdmin || authUser.isAdmin;
    if (user._id.toString() !== authUser._id.toString() && !isAdmin) {
      return res
        .status(400)
        .send({ error: "You are not authorized to view this order" });
    }

    return res
      .status(200)
      .send({ data: order, message: "Order fetched successfully" });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};
const getOrderForReceipt = async (req, res) => {
  try {
    const { order_id } = req.query;
    if (!order_id) {
      return res.status(400).send({ error: "required order_id" });
    }

    const order = await OrderModel.findOne({ _id: order_id })
      .populate("productOrders")
      .populate("payment")
      .populate("user")
      .populate({
        path: "productOrders",
        populate: [
          { path: "product" },
          {
            path: "user",
          },
          {
            path: "shop",
          },
        ],
      })

      .lean();

    return res
      .status(200)
      .send({ data: order, message: "Order fetched successfully" });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

const getOrderByOrderId = async (req, res) => {
  try {
    const { orderId } = req.query;
    if (!orderId) {
      return res.status(400).send({ error: "required orderId of order" });
    }
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return res.status(400).send({ error: "User not found" });
    }
    const order = await OrderModel.findOne({ orderId })
      .populate("productOrders")
      .populate("payment")
      .populate("user")
      .populate({
        path: "productOrders",
        populate: [
          { path: "product" },
          {
            path: "user",
          },
          {
            path: "shop",
          },
        ],
      })

      .lean();
    const user = order.user;
    const isAdmin = authUser.superAdmin || authUser.isAdmin;
    if (user._id.toString() !== authUser._id.toString() && !isAdmin) {
      return res
        .status(400)
        .send({ error: "You are not authorized to view this order" });
    }

    return res
      .status(200)
      .send({ data: order, message: "Order fetched successfully" });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};
const getProductOrders = async (req, res) => {
  try {
    const { status, shop } = req.query;

    const limit = parseInt(req.query.limit);
    const pageNumber = parseInt(req.query.pageNumber);
    if (!limit) {
      return res.status(400).send({ error: "required limit" });
    }
    if (!pageNumber) {
      return res.status(400).send({ error: "required pageNumber" });
    }

    const query = {
      ...(status && { "status.value": status }),
      ...(shop && { shop: mongoose.Types.ObjectId(shop) }),
    };

    const aggregate = [
      {
        $facet: {
          productOrders: [
            { $match: { ...query } },
            { $skip: limit * (pageNumber - 1) },
            { $limit: limit },
          ],
          totalCount: [{ $match: { ...query } }, { $count: "count" }],
        },
      },
    ];
    const productOrdersQuery = await ProductOrderModel.aggregate(
      aggregate
    ).exec();
    // populate user and product
    await ProductOrderModel.populate(productOrdersQuery[0].productOrders, {
      path: "product", // populate product
    });
    await ProductOrderModel.populate(productOrdersQuery[0].productOrders, {
      path: "shop", // populate shop
    });
    await ProductOrderModel.populate(productOrdersQuery[0].productOrders, {
      path: "user", // populate user
    });

    const productOrders = productOrdersQuery[0]?.productOrders;
    const totalCount = productOrdersQuery[0]?.totalCount[0]?.count;

    return res.status(200).send({
      data: { productOrders, totalCount },
      message: "Product Orders fetched successfully",
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};
const getProductOrder = async (req, res) => {
  try {
    const { productOrder_id } = req.query;
    if (!productOrder_id) {
      return res.status(400).send({ error: "required productOrder_id" });
    }
    const productOrder = await ProductOrderModel.findOne({
      _id: productOrder_id,
    })
      .populate("product")
      .populate("shop")
      .populate("user")

      .lean();
    if (!productOrder) {
      return res.status(200).send({
        data: null,
        message: "Product Order not found",
      });
    }
    const authUser = await getAuthUser(req);
    if (
      !authUser ||
      (productOrder.user &&
        productOrder.user.toString() !== authUser._id.toString() &&
        !authUser.superAdmin &&
        !authUser.isAdmin &&
        productOrder.shop &&
        productOrder.shop.shopId !== authUser.shopId)
    ) {
      return res.status(200).send({
        data: null,
        error: "You are not authorized to view this product order",
      });
    }

    const order = await OrderModel.findOne({
      _id: productOrder.order,
    }).lean();

    const deliveryDetails = order.deliveryDetails;
    productOrder.order = order;
    productOrder.deliveryDetails = deliveryDetails;

    return res.status(200).send({
      data: productOrder,
      message: "Product Order fetched successfully",
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};
const getProductOrderStatusHistory = async (req, res) => {
  try {
    const { productOrder_id } = req.query;
    if (!productOrder_id) {
      return res.status(400).send({ error: "required productOrder_id" });
    }
    const productOrder = await ProductOrderModel.findOne({
      _id: productOrder_id,
    }).lean();
    if (!productOrder) {
      return res.status(400).send({
        error:
          "Product Order not found. Ensure you provide a valid sub productOrder_id",
      });
    }
    const statusOptions = orderStatusEnums;
    let status = productOrder.status;
    const isCancelled = productOrder.cancel?.isCancelled;
    if (isCancelled) {
      status = productOrder.cancel.lastStatusBeforeCancel;
    }
    const statusIndex = statusOptions.findIndex(
      (s) => s.value === status.value
    );
    const statusHistory = statusOptions.slice(0, statusIndex + 1);
    // add date only when value is placed or confirmed
    statusHistory.forEach((s) => {
      if (s.value === "order placed") {
        s.date = productOrder.createdAt;
      }
      if (s.value === "order confirmed") {
        s.date = productOrder.confirmedAt;
      }
      if (s.value === "order delivered") {
        s.date = productOrder.deliveryDate;
      }
    });
    if (isCancelled) {
      statusHistory.push({
        name: "Order Cancelled",
        value: "order cancelled",
        date: productOrder.cancel.cancelledAt,
      });
    }
    const currentStatus = productOrder.status;

    const nextStatusIndex =
      statusOptions.findIndex((s) => s.value === currentStatus.value) + 1;
    const nextStatus =
      currentStatus?.value !== "order delivered" && !isCancelled
        ? statusOptions[nextStatusIndex]
        : null;
    return res.status(200).send({
      data: { statusHistory, nextStatus, currentStatus },
      message: "Product Order Status History fetched successfully",
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

const getOrderStatusOptions = async (req, res) => {
  try {
    const statusOptions = orderStatusEnums;
    return res.status(200).send({
      data: statusOptions,
      message: "Order Status Options fetched successfully",
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

const updateProductOrderStatus = async (req, res) => {
  try {
    const { productOrder_id, status } = req.body;

    let deliveryDate = null;
    let deliveryCompany = null;
    let deliveryTrackingNumber = null;
    let deliveryTrackingLink = null;

    if (!productOrder_id) {
      return res.status(400).send({ error: "required productOrder_id" });
    }
    if (!status) {
      return res.status(400).send({ error: "required status" });
    }
    const selectedStatus = orderStatusEnums.find((s) => s.value === status);
    if (!selectedStatus) {
      return res.status(400).send({ error: "Invalid status" });
    }
    if (selectedStatus.value === "order cancelled") {
      return res
        .status(400)
        .send({ error: "You can't cancel an order using this endpoint" });
    }
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return res.status(400).send({ error: "User not found" });
    }
    if (
      !selectedStatus?.sellerAction &&
      !authUser.superAdmin &&
      !authUser?.isAdmin
    ) {
      return res.status(400).send({
        error: `You are not authorized to update this order status to ${selectedStatus.name}`,
      });
    }
    const productOrder = await ProductOrderModel.findOne({
      _id: productOrder_id,
    })
      .populate("shop")
      .populate("product")
      .lean();

    if (!productOrder) {
      return res.status(400).send({ error: "Product Order not found" });
    }
    const shopid = productOrder.shop.shopId;

    if (
      authUser.shopId !== shopid &&
      !authUser.superAdmin &&
      !authUser.isAdmin
    ) {
      return res
        .status(400)
        .send({ error: "You are not authorized to update this product order" });
    }

    let confirmedAt = productOrder.confirmedAt;
    // if selected status is placed, update confirmedAt to null

    if (selectedStatus.value === "order confirmed") {
      confirmedAt = new Date();
      const createdAt = productOrder.createdAt;
      const productType = productOrder.product.productType;
      const bespokes = ["bespokeCloth", "bespokeShoe"];
    }
    if (selectedStatus.value === "order placed") {
      confirmedAt = null;
    }
    if (selectedStatus.value === "order dispatched") {
      if (!req.body.deliveryCompany) {
        return res.status(400).send({ error: "required deliveryCompany" });
      }
      deliveryCompany = req.body.deliveryCompany;
      deliveryTrackingNumber = req.body.deliveryTrackingNumber;
      deliveryTrackingLink = req.body.deliveryTrackingLink;
    }
    // nullify delivery company, tracking number and tracking link if status comes before order dispatched
    // check if status comes before order dispatched
    const dispatchedStatus = orderStatusEnums.find(
      (s) => s.value === "order dispatched"
    );
    const dispatchedStatusIndex = orderStatusEnums.findIndex(
      (s) => s.value === dispatchedStatus.value
    );
    const selectedStatusIndex = orderStatusEnums.findIndex(
      (s) => s.value === selectedStatus.value
    );
    if (selectedStatusIndex < dispatchedStatusIndex) {
      deliveryCompany = null;
      deliveryTrackingNumber = null;
      deliveryTrackingLink = null;
    }
    const shopRevenue = productOrder.shopRevenue;
    if (selectedStatus.value === "order delivered") {
      if (!req.body.deliveryDate) {
        return res.status(400).send({ error: "required deliveryDate" });
      }
      deliveryDate = new Date(req.body.deliveryDate);
    }
    // nullify delivery date if status is not order delivered
    if (selectedStatus.value !== "order delivered") {
      deliveryDate = null;
      shopRevenue.status = "pending";
    }
    let cancel = productOrder.cancel;

    if (productOrder.status.value === "order cancelled") {
      cancel = null;
      shopRevenue.status = "cancelled";
    }

    if (shopRevenue.status === "cancelled") {
      shopRevenue.status = "pending";
    }
    const UpdatedProductOrder = await ProductOrderModel.findByIdAndUpdate(
      productOrder_id,
      {
        status: selectedStatus,
        confirmedAt,
        deliveryCompany,
        deliveryTrackingNumber,
        deliveryTrackingLink,
        deliveryDate,
        cancel,
        shopRevenue,
      },
      { new: true }
    );

    const user = productOrder.user;
    const title = "Order Status Update";
    let body = `Item no ${productOrder?.itemNo} in your order with order ID - ${productOrder.orderId} has been updated to ${selectedStatus.name}`;
    const image = productOrder.images[0].link;

    const userNotification = await NotificationModel.findOne({
      user,
    });
    const pushToken = userNotification?.pushToken || [];
    if (pushToken?.length > 0) {
      const push = await sendPushMultipleDevice(pushToken, title, body, image);
    }
    const notificationParam = {
      title,
      body,
      image,
      isAdminPanel: false,
      user_id: user,
    };
    const addUserNotification = await addNotification(notificationParam);
    // for shop
    const shop_id = productOrder.shop.toString();
    if (shop_id) {
      if (selectedStatus.value === "order confirmed") {
        const expectedVendorCompletionDate =
          UpdatedProductOrder.expectedVendorCompletionDate;
        body = `You have successfully confirmed an order with order ID - ${productOrder.orderId} and item number - ${productOrder.itemNo}. This order is expected to be completed between ${expectedVendorCompletionDate.min} and ${expectedVendorCompletionDate.max}`;
      }

      const notifyShopParam = { shop_id, title, body, image };
      const notify = await notifyShop(notifyShopParam);
    }
    notificationParam.isAdminPanel = true;
    notificationParam.user_id = null;
    notificationParam.body = `Item no ${productOrder?.itemNo}  in order with order ID - ${productOrder.orderId} has been updated to ${selectedStatus.name}`;
    body = `Item no ${productOrder?.itemNo}  in order with order ID - ${productOrder.orderId} has been updated to ${selectedStatus.name}`;

    const addAdminNotification = await addNotification(notificationParam);
    const pushAllAdmins = await sendPushAllAdmins(title, body, image);

    return res.status(200).send({ data: UpdatedProductOrder });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};
const cancelOrder = async (req, res) => {
  try {
    const { productOrder_id, reason } = req.body;
    if (!productOrder_id) {
      return res
        .status(400)
        .send({ error: "required productOrder_id for the item" });
    }
    if (!reason) {
      return res.status(400).send({ error: "required reason" });
    }
    const productOrder = await ProductOrderModel.findOne({
      _id: productOrder_id,
    }).lean();
    if (!productOrder) {
      return res.status(400).send({ error: "Product Order not found" });
    }
    if (productOrder.status.value === "order cancelled") {
      return res.status(400).send({ error: "Product Order already cancelled" });
    }

    const authUser = await getAuthUser(req);
    if (
      productOrder.status.value !== "order placed" &&
      !authUser.superAdmin &&
      !authUser.isAdmin
    ) {
      return res.status(400).send({
        error:
          "You are not authorized to cancel this product order at the stage. Contact support",
      });
    }
    if (
      productOrder.user !== authUser._id &&
      !authUser.superAdmin &&
      !authUser.isAdmin
    ) {
      return res
        .status(400)
        .send({ error: "You are not authorized to cancel this product order" });
    }

    if (
      productOrder.status.value !== "order confirmed" &&
      productOrder.status.value !== "order placed"
    ) {
      return res.status(400).send({
        error:
          "You are not authorized to cancel this product order at the stage. Contact admin",
      });
    }
    const cancelledStatus = orderStatusEnums.find(
      (s) => s.value === "order cancelled"
    );
    const cancel = {
      isCancelled: true,
      reason,
      cancelledAt: new Date(),
      lastStatusBeforeCancel: productOrder.status,
    };
    const shopRevenue = productOrder.shopRevenue;
    shopRevenue.status = "cancelled";

    const updatedStatus = await ProductOrderModel.findOneAndUpdate(
      { _id: productOrder._id },
      { status: cancelledStatus, cancel, shopRevenue },
      { new: true }
    );
    const user = productOrder.user;
    const title = "Order Status Update";
    let body = `An item in your order with order ID - ${productOrder.orderId} with item number - ${productOrder.itemNo} has been cancelled`;
    const image = productOrder.images[0].link;

    const userNotification = await NotificationModel.findOne({
      user,
    });
    const pushToken = userNotification.pushToken;
    if (pushToken) {
      const push = await sendPushMultipleDevice(pushToken, title, body, image);
    }
    const notificationParam = {
      title,
      body,
      image,
      isAdminPanel: false,
      user_id: user,
    };
    const addUserNotification = await addNotification(notificationParam);
    notificationParam.isAdminPanel = true;
    notificationParam.user_id = null;
    body = `An item in order with order ID - ${productOrder.orderId} with item number - ${productOrder.itemNo} has been cancelled`;
    const addAdminNotification = await addNotification(notificationParam);
    const pushAllAdmins = await sendPushAllAdmins(title, body, image);
    const shop_id = productOrder.shop.toString();
    if (shop_id) {
      const notifyShopParam = { shop_id, title, body, image };
      const notify = await notifyShop(notifyShopParam);
    }
    return res.status(200).send({
      data: updatedStatus,
      message: "Order Item Cancelled successfully",
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};
const downloadReciept = async (req, res) => {
  try {
    const { order_id, fileName, socketId } = req.body;

    if (!order_id) {
      return res.status(400).send({ error: "order_id is required" });
    }

    if (!socketId) {
      return res.status(400).send({ error: "Socket id is required" });
    }

    const io = req.app.get("io");
    const sockets = req.app.get("sockets");

    const thisSocketId = sockets[socketId];
    const socketInstance = io.to(thisSocketId);

    socketInstance.emit("downloadProgress", {
      progress: 10,
      status: "Getting ready...",
    });

    socketInstance.emit("downloadProgress", {
      progress: 20,
      status: "Getting receipt...",
    });

    const order = await OrderModel.findOne({ _id: order_id.toString() });

    if (!order) {
      return res.status(400).send({
        error:
          "Encountered an error while verifying receipt to be attached. Please try again later or contact support if this continues",
      });
    }

    let pdf;

    socketInstance.emit("downloadProgress", {
      progress: 50,
      status: "Generating PDF...",
    });
    const website_url = `${url}/${order_id}`;
    pdf = await generatePdf({
      type: "url",
      website_url,
    });

    const today = new Date();
    const pdfFilename = fileName
      ? `${fileName}.pdf`
      : `${type}-${id}-${today.getFullYear()}-${today.getMonth()}-${today.getDate()}.pdf`;

    socketInstance.emit("downloadProgress", {
      progress: 90,
      status: "Sending PDF...",
    });

    return res.status(200).send({
      pdf,
      fileName: pdfFilename,
      message: "Downloaded successfully",
    });
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
};

module.exports = {
  createOrder,
  getAuthBuyerOrders,
  getAuthVendorProductOrders,
  getOrders,
  getProductOrders,
  getOrderStatusOptions,
  updateProductOrderStatus,
  getOrder,
  getOrderForReceipt,
  getOrderByOrderId,
  getProductOrder,
  getProductOrderStatusHistory,
  cancelOrder,
  downloadReciept,
};
