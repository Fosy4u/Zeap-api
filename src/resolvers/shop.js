const ShopModel = require("../models/shop");
const UserModel = require("../models/user");
const {
  verifyUserId,
  verifyShopId,
  replaceShopVariablesinTemplate,
  replaceUserVariablesinTemplate,
} = require("../helpers/utils");
const { getAuthUser } = require("../middleware/firebaseUserAuth");
const ProductOrderModel = require("../models/productOrder");
const EmailTemplateModel = require("../models/emailTemplate");
const { sendEmail } = require("../helpers/emailer");

function getRandomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

const generateUniqueShopId = async () => {
  let shopId;
  let found = true;

  do {
    const randomVal = getRandomInt(1000000, 9999999);
    shopId = `${randomVal}`;
    const exist = await ShopModel.findOne(
      {
        shopId,
      },
      { lean: true }
    );

    if (exist) {
      found = true;
    } else {
      found = false;
    }
  } while (found);

  return shopId.toString();
};

const createShop = async (req, res) => {
  try {
    const { shopName, country, region, phoneNumber, address } = req.body;
    if (!shopName) {
      return res.status(400).send({ error: "shopName is required" });
    }
    if (!country) {
      return res.status(400).send({ error: "country is required" });
    }
    if (!region) {
      return res.status(400).send({ error: "region is required" });
    }
    if (!phoneNumber) {
      return res.status(400).send({ error: "phoneNumber is required" });
    }
    if (!address) {
      return res.status(400).send({ error: "address is required" });
    }

    const authUser = await getAuthUser(req);

    if (!authUser) {
      return res.status(400).send({ error: "User not found" });
    }

    if (
      req.body?.userId &&
      !authUser.isAdmin &&
      !authUser.superAdmin &&
      authUser.userId !== req.body?.userId
    ) {
      return res
        .status(400)
        .send({ error: "You are not authorized to perform this operation" });
    }

    let userId;
    let user;
    if (req.body?.userId) {
      user = await UserModel.findOne({ userId: req.body?.userId }).lean();
      if (!user) {
        return res.status(400).send({ error: "User not found" });
      }
    } else {
      user = authUser;
    }

    userId = req.body?.userId || user.userId;
    const alreadyHasShop = await ShopModel.findOne({ userId });

    if (alreadyHasShop) {
      return res.status(400).send({ error: "User already has a shop" });
    }

    if (!user) {
      return res.status(400).send({ error: "User not found" });
    }

    const shopExist = await ShopModel.findOne({
      shopName,
    });
    if (shopExist) {
      return res.status(400).send({ error: "Shop name already exist" });
    }
    const shopId = await generateUniqueShopId();
    const shop = new ShopModel({
      shopId,
      ...req.body,
      user: user._id,
      userId: user.userId,
    });
    await shop.save();
    if (!shop?._id) {
      return res.status(400).send({ error: "Shop not created" });
    }
    const updatedUser = await UserModel.findOneAndUpdate(
      {
        userId,
      },
      { shopId, shopEnabled: true, isVendor: true },
      { new: true }
    ).lean();
    if (!updatedUser) {
      return res
        .status(400)
        .send({ error: "Shop created but User not updated" });
    }

    if (shop && updatedUser?.email) {
      const welcomeShopEmailTemplate = await EmailTemplateModel.findOne({
        name: "welcome-shop",
      }).lean();
      const formattedShopTemplateBody = replaceShopVariablesinTemplate(
        replaceUserVariablesinTemplate(
          welcomeShopEmailTemplate?.body,
          updatedUser
        ),
        shop
      );
      const formattedShopTemplateSubject = replaceShopVariablesinTemplate(
        replaceUserVariablesinTemplate(
          welcomeShopEmailTemplate?.subject,
          updatedUser
        ),
        shop
      );
      const param = {
        from: "admin@zeaper.com",
        to: [updatedUser?.email],
        subject: formattedShopTemplateSubject?.subject || "Welcome",
        body: formattedShopTemplateBody || "Welcome to Zeap",
      };

      const shopMail = await sendEmail(param);
    }
    return res
      .status(200)
      .send({ data: shop, message: "Shop created successfully" });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

const getShops = async (req, res) => {
  try {
    const skip = parseInt(req.query.skip) || 0;
    const limit = parseInt(req.query.limit) || 10;
    const sort = req.query.sort || "desc";
    const search = req.query.search || "";
    const match = {
      ...req.query,
       disabled: req.query.disabled ? req.query.disabled : false,
    };
    if (search) {
      match.$or = [
        { shopName: { $regex: search, $options: "i" } },
        { country: { $regex: search, $options: "i" } },
      ];
    }
    const query = { ...match };
    const shops = await ShopModel.find(query)
      .populate("user")
      .sort({ createdAt: sort })
      .skip(skip)
      .limit(limit)
      .lean();

  
    return res.status(200).send({ data: shops });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const getNewShops = async (req, res) => {
  try {
    const skip = parseInt(req.query.skip) || 0;
    const limit = parseInt(req.query.limit) || 10;
    const sort = req.query.sort || "desc";
    const search = req.query.search || "";
    const match = {
      ...req.query,
        status: "new",
    };
    if (search) {
      match.$or = [
        { shopName: { $regex: search, $options: "i" } },
        { country: { $regex: search, $options: "i" } },
      ];
    }
    const query = { ...match };
    const shops = await ShopModel.find(query)
      .populate("user")
      .sort({ createdAt: sort })
      .skip(skip)
      .limit(limit)
      .lean();

  
    return res.status(200).send({ data: shops });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const getAuthUserShop = async (req, res) => {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return res.status(400).send({ error: "User not found" });
    }
    const shop = await ShopModel.findOne({
      user: authUser._id,
    }).populate("user");
    return res.status(200).send({ data: shop });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const getShop = async (req, res) => {
  try {
    const shopId = req.query.shopId;
    if (!shopId) {
      return res.status(400).send({ error: "shopId is required" });
    }
    const shop = await ShopModel.findOne({
      ...req.query,
    }).populate("user");
    if (!shop) {
      return res.status(400).send({ error: "Shop not found" });
    }
    return res.status(200).send({ data: shop });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

const updateShop = async (req, res) => {
  try {
    const { shopId } = req.body;
    const shop = await ShopModel.findOne({
      shopId,
    });
    if (!shop) {
      return res.status(400).send({ error: "Shop not found" });
    }
    const updatedShop = await ShopModel.findOneAndUpdate(
      {
        shopId,
      },
      { ...req.body },
      { new: true }
    ).lean();

    return res.status(200).send({ data: updatedShop });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

const absoluteDeleteShop = async (req, res) => {
  try {
    const { shopId } = req.body;
    if (!shopId) {
      return res.status(400).send({ error: "shopId is required" });
    }
    const shop = await ShopModel.findOne({
      shopId,
    });
    if (!shop) {
      return res.status(400).send({ error: "Shop not found" });
    }
    await ShopModel.findOneAndDelete({
      shopId,
    });
    const user = await UserModel.findOneAndUpdate(
      {
        shopId,
      },
      { shopId: "", shopEnabled: false },
      { new: true }
    ).lean();
    return res.status(200).send({ message: "Shop deleted successfully" });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const deleteShop = async (req, res) => {
  try {
    const { shopId } = req.body;
   
    if (!shopId) {
      return res.status(400).send({ error: "shopId is required" });
    }
    const shop = await ShopModel.findOne({
      shopId,
    });
    if (!shop) {
      return res.status(400).send({ error: "Shop not found" });
    }
    await ShopModel.findOneAndUpdate(
      {
        shopId,
      },
      { disabled: true },
      { new: true }
    );
    const user = await UserModel.findOneAndUpdate(
      {
        shopId,
      },
      { shopEnabled: false },
      { new: true }
    ).lean();
    return res.status(200).send({ message: "Shop disabled successfully" });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const restoreShop = async (req, res) => {
  try {
    const { shopId } = req.body;

    if (!shopId) {
      return res.status(400).send({ error: "shopId is required" });
    }
    const shop = await ShopModel.findOne({
      shopId,
    });
    if (!shop) {
      return res.status(400).send({ error: "Shop not found" });
    }
    await ShopModel.findOneAndUpdate(
      {
        shopId,
      },
      { disabled: false },
      { new: true }
    );
    const user = await UserModel.findOneAndUpdate(
      {
        shopId,
      },
      { shopEnabled: true },
      { new: true }
    ).lean();
    return res.status(200).send({ message: "Shop restored successfully" });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

const getAuthShopRevenues = async (req, res) => {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return res.status(400).send({ error: "User not found" });
    }
    const shop = await ShopModel.findOne({ shopId: authUser.shopId }).lean();
    if (!shop) {
      return res.status(400).send({ error: "Shop not found" });
    }
    const shopRevenuesQury = await ProductOrderModel.find({ shop: shop._id })
      .populate("product")
      .lean();
    const shopRevenues = shopRevenuesQury.map((order) => {
      const product = order.product;

      const shopRevenue = order.shopRevenue;
      const amount = order.amount.find((a) => a.currency === "NGN");
      return {
        purchaseDate: order.createdAt,
        buyerPaid: amount,
        shopRevenue,
        purchasedProduct: {
          title: product.title,
          productId: product.productId,
          productType: product.productType,
          sku: order.sku,
          images: order.images,
        },
      };
    });
    return res.status(200).send({
      data: shopRevenues,
      message: "Shop revenues fetched successfully",
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};
const getShopRevenues = async (req, res) => {
  try {
    const { shopId } = req.query;
    if (!shopId) {
      return res.status(400).send({ error: "shopId is required" });
    }

    const shop = await ShopModel.findOne({ shopId }).lean();
    if (!shop) {
      return res.status(400).send({ error: "Shop not found" });
    }
    const shopRevenuesQury = await ProductOrderModel.find({ shop: shop._id })
      .populate("product")
      .lean();
    const shopRevenues = shopRevenuesQury.map((order) => {
      const product = order.product;
      const productOrder_id = order._id;
      const shopRevenue = order.shopRevenue;
      shopRevenue.status =
        order?.status?.value === "order cancelled"
          ? "cancelled"
          : shopRevenue.status;
      const amount = order.amount.find((a) => a.currency === "NGN");
      const images = order.images;
      // resizes images
      return {
        productOrder_id,
        purchaseDate: order.createdAt,
        buyerPaid: amount,
        shopRevenue,
        purchasedProduct: {
          title: product.title,
          productId: product.productId,
          productType: product.productType,
          sku: order.sku,
          images,
        },
      };
    });
    return res.status(200).send({
      data: shopRevenues,
      message: "Shop revenues fetched successfully",
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

const changeShopStatus = async (req, res) => {
  try {
    const { shopId, status } = req.body;
    if (!shopId) {
      return res.status(400).send({ error: "shopId is required" });
    }
    if (!status) {
      return res.status(400).send({ error: "status is required" });
    }
    const shopStatusEnums = ["new", "reviewed"];
    if (!shopStatusEnums.includes(status)) {
      return res.status(400).send({ error: "Invalid status value provided" });
    }
    const shop = await ShopModel.findOne({
      shopId,
    });
    if (!shop) {
      return res.status(400).send({ error: "Shop not found" });
    }
    const updatedShop = await ShopModel.findOneAndUpdate(
      {
        shopId,
      },
      { status },
      { new: true }
    ).lean();

    return res.status(200).send({ data: updatedShop });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

module.exports = {
  createShop,
  getShops,
  getNewShops,
  getShop,
  getAuthUserShop,
  updateShop,
  deleteShop,
  restoreShop,
  absoluteDeleteShop,
  generateUniqueShopId,
  getAuthShopRevenues,
  getShopRevenues,
  changeShopStatus,
};
