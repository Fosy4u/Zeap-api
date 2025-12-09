const PaymentModel = require("../models/payment");
const BasketModel = require("../models/basket");
const { ENV } = require("./../config");
const {
  calculateTotalBasketPrice,
  codeGenerator,
  currencyCoversion,
  replaceUserVariablesinTemplate,
  replaceOrderVariablesinTemplate,
  covertToNaira,
  detectDeviceType,
} = require("../helpers/utils");
const request = require("request");
const { getAuthUser } = require("../middleware/firebaseUserAuth");
const DeliveryAddressModel = require("../models/deliveryAddresses");
const { createOrder } = require("./order");
const OrderModel = require("../models/order");
const { addPointAfterSales } = require("./point");
const ProductOrderModel = require("../models/productOrder");
const { notifyShop } = require("./notification");
const { sendEmail } = require("../helpers/emailer");
const EmailTemplateModel = require("../models/emailTemplate");
const UserModel = require("../models/user");
const Stripe = require("stripe");
const { allowedDeliveryCountries } = require("../helpers/constants");
const { update } = require("lodash");
const { verifyPaystackPayment, verifyPaystack } = require("../helpers/paystack");
const { verifyStripePayment } = require("../helpers/stripe");

const secretKey =
  ENV === "dev"
    ? process.env.PAYSTACK_SECRET_TEST_KEY
    : process.env.PAYSTACK_SECRET_LIVE_KEY;

const stripeKey =
  ENV === "dev"
    ? process.env.STRIPE_SECRET_KEY_TEST
    : process.env.STRIPE_SECRET_KEY_LIVE;

const stripe = new Stripe(stripeKey, {
  apiVersion: "2024-06-20", // keep current
});
const stripewebhookSecret =
  ENV === "dev"
    ? process.env.STRIPE_WEBHOOK_SECRET_TEST
    : process.env.STRIPE_WEBHOOK_SECRET_LIVE;

const generateReference = (param) => {
  const { firstName, lastName, basketId } = param;
  const firstChar = firstName.charAt(0).toUpperCase();
  const lastChar = lastName.charAt(0).toUpperCase();
  const today = new Date();
  const ref = `${firstChar}${lastChar}-${basketId}-${today.getTime()}`;
  return ref;
};

const getStripeClientSecret = async (
  amount,
  currency,
  reference,
  basketId,
  userId
) => {
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      payment_method_types: ["card"],
      metadata: { reference, basketId, userId },
    });

    return {
      stripeClientSecret: paymentIntent.client_secret,
      stripePaymentIntentId: paymentIntent.id,
    };
  } catch (error) {
    console.error("Error creating Stripe payment intent:", error);
    throw new Error("Failed to create payment intent");
  }
};

const getReference = async (req, res) => {
  try {
    const {
      basketId,
      firstName,
      lastName,
      country,
      region,
      address,
      phoneNumber,
      postCode,
      method,
    } = req.query;

    let paymentStatus = "pending";
    let orderId = null;
    let order = null;

    if (!firstName) {
      return res
        .status(400)
        .send({ error: "required firstName for delivery address" });
    }
    if (!lastName) {
      return res
        .status(400)
        .send({ error: "required lastName for delivery address" });
    }
    if (!country) {
      return res
        .status(400)
        .send({ error: "required country in delivery address" });
    }

    if (!allowedDeliveryCountries.includes(country)) {
      return res.status(400).send({
        error: `country not supported. Supported countries are ${allowedDeliveryCountries}`,
      });
    }
    if (!region) {
      return res
        .status(400)
        .send({ error: "required region in delivery address" });
    }
    if (!address) {
      return res
        .status(400)
        .send({ error: "required address in delivery address" });
    }
    if (!phoneNumber) {
      return res
        .status(400)
        .send({ error: "required phoneNumber in delivery address" });
    }
    if (!method) {
      return res.status(400).send({ error: "required delivery method" });
    }
    if (method !== "standard" && method !== "express") {
      return res
        .status(400)
        .send({ error: "delivery method must be either standard or express" });
    }
    const deliveryDetails = {
      address,
      region,
      country,
      phoneNumber,
      firstName,
      lastName,
      postCode,
    };
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return res.status(400).send({ error: "User not found" });
    }
    if (authUser.disabled) {
      return res.status(400).send({ error: "User is disabled" });
    }
    if (authUser.isGuest) {
      const { email } = authUser;

      if (!email) {
        return res
          .status(400)
          .send({ error: "As a guest, update  email for receipt and contact" });
      }
    }
    const basketQuery = {
      ...(basketId && { basketId }),
      ...(!basketId && { user: authUser._id }),
    };

    const basket = await BasketModel.findOne(basketQuery)
      .populate("user")
      .lean();
    if (!basket) {
      return res.status(404).send({ error: "Basket not found" });
    }
    const user = basket.user;
    if (
      basketId &&
      !authUser.isAdmin &&
      !authUser.superAdmin &&
      user._id !== authUser._id
    ) {
      return res.status(400).send({
        error:
          "You are not authorized to make payment for this basket. Ensure you are not sending basketId as query parameter as you are not an admin",
      });
    }

    const currency = authUser.prefferedCurrency || "NGN";
    const deviceType = detectDeviceType(req);

    if (
      authUser._id.toString() !== basket.user._id.toString() &&
      !authUser.isAdmin &&
      !authUser.superAdmin
    ) {
      return res.status(400).send({
        error: "You are not authorized to make payment for this basket",
      });
    }

    const payment = await PaymentModel.findOne({
      basket: basket._id.toString(),
    }).lean();
    let stripeClientSecret = null;
    let stripePaymentIntentId = null;
    let reference = payment?.reference || null;
    let updatedPayment = payment;
    if (payment) {
      if (currency === "NGN") {
        verifyPaystack(payment?.reference, async (error, body) => {
          const response = JSON.parse(body);
          if (response.status === true) {
            const {
              amount,
              status,
              paidAt,
              channel,
              currency,
              transaction_date,
              log,
              fees,
              gateway_response,
              authorization,
            } = response.data;
            const { card_type, bank, country_code } = authorization;

            if (status === "success") {
              paymentStatus = "success";
              updatedPayment = await PaymentModel.findOneAndUpdate(
                { reference },
                {
                  amount,
                  status,
                  paidAt,
                  channel,
                  currency,
                  transactionDate: transaction_date,
                  log,
                  fees,
                  cardType: card_type,
                  bank,
                  countryCode: country_code,
                  gatewayResponse: gateway_response,
                  deliveryMethod: method,
                  gateway: "paystack",
                  deviceType,
                },
                { new: true }
              );
            }
          }
        });
      } else if (payment.stripePaymentIntentId) {
        // verify stripe payment status
        const stripePaymentIntentId = payment.stripePaymentIntentId;

        const paymentIntent = await stripe.paymentIntents.retrieve(
          stripePaymentIntentId,
          {
            expand: ["payment_method", "charges.data.balance_transaction"],
          }
        );

        if (paymentIntent && paymentIntent?.status === "succeeded") {
          paymentStatus = "success";
          // get the events to retrieve log
          // format log into obj with properties
          const events = await stripe.events.list({
            limit: 50,
          });
          const piEvents = events.data.filter(
            (e) => e.data.object.id === paymentIntent.id
          );
          const log = piEvents.map((e) => ({
            id: e.id,
            type: e.type,
            created: new Date(e.created * 1000),
            data: e.data.object,
          }));

          const paymentMethod = paymentIntent.payment_method;
          const charge = paymentIntent.charges?.data?.[0] || null;

          updatedPayment = await PaymentModel.findOneAndUpdate(
            { reference },
            {
              status: "success",
              paidAt: new Date(paymentIntent.created * 1000),
              channel: paymentMethod?.type || "card",
              currency: paymentIntent.currency.toUpperCase(),
              transactionDate: paymentIntent.created,
              log,
              fees: charge?.balance_transaction?.fee || 0,
              cardType: paymentMethod?.card?.brand || "",
              bank: paymentMethod?.card?.funding || "",
              countryCode: paymentMethod.card.country,
              gatewayResponse: charge?.outcome?.seller_message || "",
              gateway: "stripe",
              deviceType,
            },
            { new: true }
          );
        }
      }
      if (paymentStatus === "success") {
        // 1000 naira = 10 points
        // round down to the nearest 1000
        const itemsTotalAmount = updatedPayment.itemsTotal;
        const itemsTotalAmountInNairaAndKobo = await covertToNaira(
          itemsTotalAmount,
          updatedPayment.currency
        );
        // convert all from kobo to naira
        const itemsTotalAmountInNaira = itemsTotalAmountInNairaAndKobo / 100;
        const pointToAdd = Math.floor(itemsTotalAmountInNaira / 1000) * 10;
        // check if order already exists
        const existingOrder = await OrderModel.findOne({
          payment: updatedPayment._id,
        }).lean();
        orderId = existingOrder?.orderId;
        order = existingOrder;
        if (!existingOrder) {
          const newOrder = await createOrder({
            payment: updatedPayment,
            user: updatedPayment.user,
            gainedPoints: pointToAdd,
          });
          if (newOrder.error) {
            return res.status(400).send({ error: newOrder.error });
          }
          order = newOrder.order;
          orderId = order?.orderId;
          const addPoints = await addPointAfterSales(
            updatedPayment.user,
            pointToAdd
          );
        }

        return res.status(200).send({
          message: "Payment already made",
          data: {
            reference: payment.reference,
            amount: payment.amount,
            currency,
            fullName: payment.fullName,
            email: payment.email,
            paymentStatus,
            orderId,
            order,
          },
        });
      }
    }
    const calculateTotal = await calculateTotalBasketPrice(
      basket,
      country,
      method
    );

    const amountDue = calculateTotal.total;
    const itemsTotalDue = calculateTotal.itemsTotal;
    const deliveryFeeDue = calculateTotal.deliveryFee;
    const appliedVoucherAmountDue = calculateTotal.appliedVoucherAmount;
    const totalDue = calculateTotal.total;
    // convert amount to kobo or cent
    const amount = (await currencyCoversion(amountDue, currency)) * 100;
    const itemsTotal = (await currencyCoversion(itemsTotalDue, currency)) * 100;
    const deliveryFee =
      (await currencyCoversion(deliveryFeeDue, currency)) * 100;
    const appliedVoucherAmount =
      (await currencyCoversion(appliedVoucherAmountDue, currency)) * 100;
    const total = (await currencyCoversion(totalDue, currency)) * 100;

    const fullName = user.firstName + " " + user.lastName;
    const email = user.email;
    reference = generateReference({
      firstName: user.firstName,
      lastName: user.lastName,
      basketId: basket.basketId,
    });
    if (currency !== "NGN") {
      const stripe = await getStripeClientSecret(
        Number(total),
        currency.toLowerCase(),
        reference,
        basket.basketId,
        user.userId
      );
      stripeClientSecret = stripe.stripeClientSecret;
      stripePaymentIntentId = stripe.stripePaymentIntentId;
    }

    const addDeliveryDetail = await BasketModel.findOneAndUpdate(
      { basketId: basket.basketId },
      { deliveryDetails },
      { new: true }
    );
    if (!addDeliveryDetail) {
      return res
        .status(400)
        .send({ error: "Error in adding delivery address to basket" });
    }

    if (payment) {
      const updatePayment = await PaymentModel.findOneAndUpdate(
        { basket: basket._id.toString() },
        {
          currency,
          amount,
          fullName,
          email,
          itemsTotal,
          deliveryFee,
          total,
          appliedVoucherAmount,
          reference,
          stripeClientSecret,
          stripePaymentIntentId,
          deliveryMethod: method,
          deviceType,
        },
        { new: true }
      );
      if (!updatePayment) {
        return res
          .status(400)
          .send({ error: "unable to update payment reference" });
      }

      return res.status(200).send({
        data: {
          reference,
          stripeClientSecret,
          currency,
          amount,
          fullName,
          email,
          paymentStatus,
          orderId,
        },
        message: "Reference fetched successfully",
      });
    }

    const newPayment = new PaymentModel({
      reference,
      stripeClientSecret,
      stripePaymentIntentId,
      user: user._id,
      fullName,
      email,
      basket: basket._id,
      status: "pending",
      amount,
      currency,
      itemsTotal,
      deliveryFee,
      total,
      appliedVoucherAmount,
      deliveryMethod: method,
      deviceType,
    });

    await newPayment.save();
    return res.status(200).send({
      data: {
        reference,
        stripeClientSecret,
        amount,
        currency,
        fullName,
        email,
        paymentStatus,
        orderId,
      },
      message: "Reference fetched successfully",
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};



const initializePayment = (form, mycallback) => {
  const options = {
    url: "https://api.paystack.co/transaction/initialize",
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/json",
      "cache-control": "no-cache",
    },
    form,
  };

  const callback = (error, response, body) => {
    return mycallback(error, body);
  };
  request.post(options, callback);
};

const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).send({ error: "Reference is required" });
    }

    let payment = await PaymentModel.findOne({ reference }).lean();
    if (!payment) {
      return res.status(404).send({
        error: "Payment not found. Please ensure the reference is correct",
      });
    }

    let updatedPayment = payment;
    const currency = payment.currency || "NGN";

    // ------------------------------------------------------------
    // PAYSTACK
    // ------------------------------------------------------------
    if (payment.status !== "success" && currency === "NGN") {
      let response;

      try {
        response = await verifyPaystackPayment(reference);
      } catch (err) {
        return res.status(400).send({ error: err.message });
      }

      if (!response.status || !response.data) {
        return res.status(400).send({ error: "Payment not successful" });
      }

      const data = response.data;
      const { authorization } = data;

      updatedPayment = await PaymentModel.findOneAndUpdate(
        { reference },
        {
          amount: data.amount,
          status: data.status,
          paidAt: data.paidAt,
          channel: data.channel,
          currency: data.currency,
          transactionDate: data.transaction_date,
          log: data.log,
          fees: data.fees,
          cardType: authorization?.card_type,
          bank: authorization?.bank,
          countryCode: authorization?.country_code,
          gatewayResponse: data.gateway_response,
          gateway: "paystack",
        },
        { new: true }
      ).lean();
    }

    // ------------------------------------------------------------
    // STRIPE
    // ------------------------------------------------------------
    if (payment.status !== "success" && currency !== "NGN") {
      try {
        const { paymentIntent, log } = await verifyStripePayment(
          payment.stripePaymentIntentId
        );

        const method = paymentIntent.payment_method;
        const charge = paymentIntent.charges?.data?.[0];

        updatedPayment = await PaymentModel.findOneAndUpdate(
          { reference },
          {
            status: "success",
            paidAt: new Date(paymentIntent.created * 1000),
            channel: method?.type || "card",
            currency: paymentIntent.currency.toUpperCase(),
            transactionDate: paymentIntent.created,
            log,
            fees: charge?.balance_transaction?.fee || 0,
            cardType: method?.card?.brand,
            bank: method?.card?.funding,
            countryCode: method?.card?.country,
            gatewayResponse: charge?.outcome?.seller_message || "",
            gateway: "stripe",
          },
          { new: true }
        ).lean();
      } catch (err) {
        return res.status(400).send({ error: err.message });
      }
    }

    // ------------------------------------------------------------
    // POINTS, ORDER CREATION, EMAIL (unchanged)
    // ------------------------------------------------------------
    const itemsTotalAmountInKobo = await covertToNaira(
      updatedPayment.itemsTotal,
      currency
    );
    const itemsTotalAmountInNaira = itemsTotalAmountInKobo / 100;
    const pointToAdd = Math.floor(itemsTotalAmountInNaira / 1000) * 10;

    const existingOrder = await OrderModel.findOne({
      payment: updatedPayment._id,
    }).lean();

    if (existingOrder) {
      return res.status(200).send({
        message: "Payment verified successfully",
        data: {
          payment: updatedPayment,
          order: existingOrder,
          addedPoints: pointToAdd,
        },
      });
    }

    const newOrder = await createOrder({
      payment: updatedPayment,
      user: updatedPayment.user,
      gainedPoints: pointToAdd,
    });

    if (newOrder.error) {
      return res.status(400).send({ error: newOrder.error });
    }

    const order = newOrder.order;

    await addPointAfterSales(updatedPayment.user, pointToAdd);
    order.orderPoints = pointToAdd;

    const orderEmailTemplate = await EmailTemplateModel.findOne({
      name: "successful-order",
    }).lean();

    const user = await UserModel.findById(updatedPayment.user).lean();

    const emailBody = replaceOrderVariablesinTemplate(
      replaceUserVariablesinTemplate(orderEmailTemplate?.body, user),
      order
    );
    const emailSubject = replaceOrderVariablesinTemplate(
      replaceUserVariablesinTemplate(orderEmailTemplate?.subject, user),
      order
    );

    await sendEmail({
      from: "admin@zeaper.com",
      to: [user.email],
      subject: emailSubject,
      body: emailBody,
      attach: true,
      order_id: order._id,
    });

    return res.status(200).send({
      message: "Payment verified successfully",
      data: { payment: updatedPayment, order, addedPoints: pointToAdd },
    });
  } catch (error) {
    console.error("Verify Payment Error:", error);
    return res.status(500).send({ error: error.message });
  }
};

const stripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = await stripe.webhooks.constructEvent(
      req.body,
      sig,
      stripewebhookSecret
    );
  } catch (err) {
    console.error("Error constructing webhook event:", err);
    return res.status(400).send({ error: "Webhook error" });
  }

  switch (event.type) {
    case "payment_intent.payment_failed":
      const paymentError = event.data.object;

      break;
    case "payment_intent.succeeded":
      try {
        const paymentIntent = event.data.object;

        // Handle successful payment here, e.g., update your database
        const reference = paymentIntent.metadata.reference;
        const payment = await PaymentModel.findOne({ reference }).lean();
        const currency = payment?.currency || "USD";
        console.log(
          `💳 Webhook received for order ${reference}, waiting before DB update...`
        );
        // Introduce a delay to give manual verification priority in updating the payment status
        await new Promise((resolve) => setTimeout(resolve, 60000));
        console.log(`💳 Processing webhook for order ${reference}...`);

        if (payment && payment.status !== "success") {
          // Take the latest charge (if present
          const charge = paymentIntent.charges?.data?.[0] || null;
          if (paymentIntent.status !== "succeeded") {
            return res.status(400).send({
              error: "Payment not successful",
            });
          }
          const log = [];
          // get the events to retrieve log
          // format log into obj with properties
          const events = await stripe.events.list({
            limit: 50,
          });
          const piEvents = events.data.filter(
            (e) => e.data.object.id === paymentIntent.id
          );
          piEvents.forEach((e) => {
            log.push({
              id: e.id,
              type: e.type,
              created: new Date(e.created * 1000),
              data: e.data.object,
            });
          });
          // ✅ The payment_method id
          const paymentMethodId = paymentIntent.payment_method;
          // Retrieve the PaymentMethod object
          const paymentMethod = await stripe.paymentMethods.retrieve(
            paymentMethodId
          );

          const updatedPayment = await PaymentModel.findOneAndUpdate(
            { reference },
            {
              status: "success",
              paidAt: new Date(paymentIntent.created * 1000),
              channel: paymentMethod?.type || "card",
              currency: paymentIntent.currency.toUpperCase(),
              transactionDate: paymentIntent.created,
              log,
              fees: charge?.balance_transaction?.fee || 0,
              cardType: paymentMethod?.card?.brand || "",
              bank: paymentMethod?.card?.funding || "",
              countryCode: paymentMethod.card.country,
              gatewayResponse: charge?.outcome?.seller_message || "",
              gateway: "stripe",
            },
            { new: true }
          );
          // convert itemAmount to naira

          // 1000 naira = 10 points
          // round down to the nearest 1000
          const itemsTotalAmount = updatedPayment.itemsTotal;

          const itemsTotalAmountInNairaAndKobo = await covertToNaira(
            itemsTotalAmount,
            currency
          );

          // convert all from kobo to naira
          const itemsTotalAmountInNaira = itemsTotalAmountInNairaAndKobo / 100;

          const pointToAdd = Math.floor(itemsTotalAmountInNaira / 1000) * 10;

          const existingOrder = await OrderModel.findOne({
            payment: updatedPayment._id,
          }).lean();
          if (existingOrder) {
            return res.status(200).send({
              message: "Payment verified successfully",
              data: {
                payment: updatedPayment,
                order: existingOrder,
                addedPoints: pointToAdd,
              },
            });
          }

          const newOrder = await createOrder({
            payment: updatedPayment,
            user: updatedPayment.user,
            gainedPoints: pointToAdd,
          });
          if (newOrder.error) {
            return res.status(400).send({ error: newOrder.error });
          }
          const order = newOrder.order;
          const addPoints = await addPointAfterSales(
            updatedPayment.user,
            pointToAdd
          );
          order.orderPoints = pointToAdd;
          const orderEmailTemplate = await EmailTemplateModel.findOne({
            name: "successful-order",
          }).lean();
          const user = await UserModel.findOne({
            _id: updatedPayment.user,
          }).lean();
          const email = user.email;
          const formattedOrderTemplateBody = replaceOrderVariablesinTemplate(
            replaceUserVariablesinTemplate(orderEmailTemplate?.body, user),
            order
          );

          const formattedOrderTemplateSubject = replaceOrderVariablesinTemplate(
            replaceUserVariablesinTemplate(orderEmailTemplate?.subject, user),
            order
          );

          const param = {
            from: "admin@zeaper.com",
            to: [email],
            subject: formattedOrderTemplateSubject || "Welcome",
            body: formattedOrderTemplateBody || "Welcome to Zeap",
            attach: true,
            order_id: order._id,
          };
          const orderMail = await sendEmail(param);
        }
      } catch (error) {
        console.error("Error handling payment_intent.succeeded:", error);
        return res.status(400).send({ error: "Webhook handler error" });
      }
      break;

    default:
      console.warn("Unhandled event type:", event.type);
  }

  res.status(200).send({ received: true });
};

const getPayments = async (req, res) => {
  try {
    const payments = await PaymentModel.find()
      .populate("user")
      .lean()
      .sort({ updatedAt: -1 });

    return res.status(200).send({
      data: payments,
      message: "Payments fetched successfully",
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};
const getPayment = async (req, res) => {
  try {
    const { reference } = req.query;
    if (!reference) {
      return res.status(400).send({ error: "required reference" });
    }
    const payment = await PaymentModel.findOne({ reference })
      .lean()
      .populate("user");
    return res.status(200).send({
      data: payment,
      message: "Payment fetched successfully",
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

const getUserPayments = async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).send({ error: "required user_id" });
    }
    const payments = await PaymentModel.find({ user: user_id }).lean();
    return res.status(200).send({
      data: payments,
      message: "Payments fetched successfully",
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

const getUserPayment = async (req, res) => {
  try {
    const { user_id, reference } = req.query;
    if (!user_id) {
      return res.status(400).send({ error: "required user_id" });
    }
    if (!reference) {
      return res.status(400).send({ error: "required reference" });
    }
    const payment = await PaymentModel.findOne({
      user: user_id,
      reference,
    }).lean();
    return res.status(200).send({
      data: payment,
      message: "Payment fetched successfully",
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

// const initialisePayment = async () => {
//   try {
//     const form = {
//       amount: 12000000,
//       email: "foster.ogwudu@yahoo.com",
//       currency: "NGN",
//       reference: "89290610605",
//       callback_url: "http://localhost:3000",
//       full_name: "Arinze Uzeto",
//     };
//     initializePayment(form, (error, body) => {
//       if (error) {
//         reject(error.message);
//       }
//       const response = JSON.parse(body);
//       console.log("response", response);

//       return response;
//     });
//   } catch (error) {
//     error.source = "Start Payement Service";
//     return reject(error);
//   }
// };
// initialisePayment().then(response => {
//     console.log("response", response)
// }).catch(error => {
//     console.log("error", error)
// })
const payShop = async (req, res) => {
  try {
    const { productOrder_id, paidAt, reference } = req.body;
    if (!productOrder_id) {
      return res.status(400).send({ error: "required productOrder_id" });
    }
    if (!paidAt) {
      return res.status(400).send({ error: "required paidAt" });
    }
    if (!reference) {
      return res.status(400).send({ error: "required reference" });
    }
    const authUser = await getAuthUser(req);
    if (!authUser.isAdmin && !authUser.superAdmin) {
      return res.status(400).send({
        error: "You are not authorized to make payment to shop for this order",
      });
    }
    const productOrder = await ProductOrderModel.findOne({
      _id: productOrder_id,
    }).lean();
    if (!productOrder) {
      return res.status(404).send({ error: "Product Order not found" });
    }
    const status = productOrder.status.value;
    if (status !== "order delivered") {
      return res.status(400).send({ error: "Order not delivered" });
    }

    const shopRevenue = productOrder.shopRevenue;
    if (shopRevenue.status === "paid") {
      return res.status(400).send({ error: "Shop revenue already paid" });
    }
    shopRevenue.status = "paid";
    shopRevenue.paidAt = paidAt;
    shopRevenue.reference = reference;
    const updatedProductOrder = await ProductOrderModel.findOneAndUpdate(
      { _id: productOrder_id },
      { shopRevenue },
      { new: true }
    );
    if (!updatedProductOrder) {
      return res.status(400).send({ error: "unable to update shop revenue" });
    }
    const shop_id = productOrder.shop.toString();
    if (shop_id) {
      const title = "Payment Received for Order";
      const itemNo = productOrder.itemNo;
      const body = `Payment received for item no ${itemNo} in the order - ${productOrder.orderId}`;
      const image = productOrder.images[0].link;
      const notifyShopParam = { shop_id, title, body, image };
      const notify = await notifyShop(notifyShopParam);
    }
    return res.status(200).send({
      data: updatedProductOrder,
      message: "Shop revenue updated successfully",
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};
const revertPayShop = async (req, res) => {
  try {
    const { productOrder_id } = req.body;
    if (!productOrder_id) {
      return res.status(400).send({ error: "required productOrder_id" });
    }
    const authUser = await getAuthUser(req);
    if (!authUser.isAdmin && !authUser.superAdmin) {
      return res.status(400).send({
        error:
          "You are not authorized to revert payment to shop for this order",
      });
    }
    const productOrder = await ProductOrderModel.findOne({
      _id: productOrder_id,
    }).lean();
    if (!productOrder) {
      return res.status(404).send({ error: "Product Order not found" });
    }

    const shopRevenue = productOrder.shopRevenue;
    if (shopRevenue.status === "pending") {
      return res.status(400).send({ error: "Shop revenue already pending" });
    }
    shopRevenue.status = "pending";
    shopRevenue.paidAt = null;
    shopRevenue.reference = null;
    const updatedProductOrder = await ProductOrderModel.findOneAndUpdate(
      { _id: productOrder_id },
      { shopRevenue },
      { new: true }
    );
    if (!updatedProductOrder) {
      return res.status(400).send({ error: "unable to update shop revenue" });
    }
    return res.status(200).send({
      data: updatedProductOrder,
      message: "Shop revenue updated successfully",
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

module.exports = {
  getReference,
  verifyPayment,
  getPayments,
  getPayment,
  getUserPayments,
  getUserPayment,
  payShop,
  revertPayShop,
  stripeWebhook,
};
