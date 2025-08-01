const { uniq } = require("lodash");
const mongoose = require("mongoose");
const timestamp = require("mongoose-timestamp");
const { deliveryDetailsSchema } = require("../deliveryDetails");



const BasketSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Users",
    required: true,
    unique: true,
  },
  basketId: { type: String, required: true },
  voucher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Vouchers",
    required: false,
  },
  basketItems: [
    {
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
        required: true,
      },
      quantity: { type: Number, required: true },
      sku: { type: String, required: true },
      bespokeColor: { type: String, required: false },
      bespokeInstruction: { type: String, required: false },
      bodyMeasurements: [
        {
          name: { type: String, required: true },
          measurements: [
            {
              field: { type: String, required: true },
              value: { type: Number, required: true },
              unit: { type: String, required: false, value: "inch" },
            },
          ],
        },
      ],
    },
  ],
  deliveryDetails: {
    type: deliveryDetailsSchema,
    required: false,
  },

  deliveryAddress: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "DeliveryAddress",
    required: false,
  },
});
BasketSchema.plugin(timestamp);

const BasketModel = mongoose.model("Baskets", BasketSchema, "Baskets");

module.exports = BasketModel;
