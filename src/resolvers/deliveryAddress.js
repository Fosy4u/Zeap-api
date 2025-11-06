
const { getAuthUser } = require("../middleware/firebaseUserAuth");
const DeliveryAddressModel = require("../models/deliveryAddresses");
const OrderModel = require("../models/order");

const createDeliveryAddress = async (req, res) => {
  try {
    const {
      address,
      region,
      country,
      phoneNumber,
      firstName,
      lastName,
      isDefault,
    } = req.body;
    if (!address) {
      return res.status(400).send({ error: "required address" });
    }
    if (!region) {
      return res.status(400).send({ error: "required region" });
    }
    if (!country) {
      return res.status(400).send({ error: "required country" });
    }
    if (!firstName) {
      return res.status(400).send({ error: "required firstName" });
    }
    if (!lastName) {
      return res.status(400).send({ error: "required lastName" });
    }
    // if (!postalCode) {
    //   return res.status(400).send({ error: "required postalCode" });
    // }
    if (!phoneNumber) {
      return res.status(400).send({ error: "required phoneNumber" });
    }

    const authUser = await getAuthUser(req);
    if (!authUser) {
      return res.status(400).send({ error: "User not found" });
    }
    if (authUser?.isGuest) {
      return res
        .status(400)
        .send({ error: "Guest user cannot add delivery address" });
    }

    const userDeliveryAddresses = await DeliveryAddressModel.find({
      user: authUser._id,
    });
   
    // check if user already has default address
    if (isDefault) {
      const defaultAddress = userDeliveryAddresses.find(
        (address) => address.isDefault
      );
      if (defaultAddress) {
        await DeliveryAddressModel.findOneAndUpdate(
          { _id: defaultAddress._id },
          { isDefault: false }
        );
      }
    }
    const alreadyExist = userDeliveryAddresses.find(
      (userAddress) =>
        userAddress.address === address &&
        userAddress.region === region &&
        userAddress.country === country
    );

    if (alreadyExist && alreadyExist._id) {
      const updatedAddress = await DeliveryAddressModel.findOneAndUpdate(
        { _id: alreadyExist._id },
        {
          region,
          country,
          phoneNumber,
          firstName,
          lastName,
          isDefault,
        },
        { new: true }
      );

      return res.status(200).send({ data: updatedAddress });
    }
    const deliveryAddress = await DeliveryAddressModel.create({
      ...req.body,
      isDefault,
      user: authUser._id,
    });
    return res.status(200).send({ data: deliveryAddress });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

const getDeliveryAddresses = async (req, res) => {
  try {
    const { user_id } = req.query;

    const authUser = await getAuthUser(req);
    if (
      user_id &&
      !authUser.isAdmin &&
      !authUser.superAdmin &&
      authUser._id.toString() !== user_id
    ) {
      return res
        .status(400)
        .send({ error: "You are not authorized to fetch delivery addresses" });
    }

    const deliveryAddresses = await DeliveryAddressModel.find({
      user: authUser._id.toString(),
      disabled: false,
    });
    return res.status(200).send({ data: deliveryAddresses });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

const updateDeliveryAddress = async (req, res) => {
  try {
    const { address_id, address, region, country, postalCode, phoneNumber } =
      req.body;
    if (!address_id) {
      return res.status(400).send({ error: "required address_id" });
    }
    if (!address) {
      return res.status(400).send({ error: "required address" });
    }
    if (!region) {
      return res.status(400).send({ error: "required region" });
    }
    if (!country) {
      return res.status(400).send({ error: "required country" });
    }

    if (!phoneNumber) {
      return res.status(400).send({ error: "required phoneNumber" });
    }

    const authUser = await getAuthUser(req);
    if (!authUser) {
      return res.status(400).send({ error: "User not found" });
    }

    const deliveryAddress = await DeliveryAddressModel.findOneAndUpdate(
      { _id: address_id, user: authUser._id },
      {
        address,
        region,
        country,
        postalCode,
        phoneNumber,
      },
      { new: true }
    );
    return res.status(200).send({ data: deliveryAddress });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

const deleteDeliveryAddress = async (req, res) => {
  try {
    const { address_id } = req.body;
    if (!address_id) {
      return res.status(400).send({ error: "required address_id" });
    }

    const authUser = await getAuthUser(req);
    if (!authUser) {
      return res.status(400).send({ error: "User not found" });
    }
    const orderWithAddress = await OrderModel.findOne({
      deliveryAddress: address_id,
    }).lean();
    if (orderWithAddress) {
      await DeliveryAddressModel.findOneAndUpdate(
        { _id: address_id },
        { disabled: true }
      );
      return res.status(200).send({ message: "Delivery address disabled" });
    }

    await DeliveryAddressModel.findOneAndDelete({
      _id: address_id,
      user: authUser._id,
    });
    return res.status(200).send({ message: "Delivery address deleted" });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

const setDefaultDeliveryAddress = async (req, res) => {
  try {
    const { address_id } = req.body;
    if (!address_id) {
      return res.status(400).send({ error: "required address_id" });
    }

    const authUser = await getAuthUser(req);
    if (!authUser) {
      return res.status(400).send({ error: "User not found" });
    }

    const userDeliveryAddresses = await DeliveryAddressModel.find({
      user: authUser._id,
    });

    const exist = userDeliveryAddresses.find(
      (address) => address._id.toString() === address_id
    );
    if (!exist) {
      return res.status(404).send({ error: "Address not found" });
    }
    const defaultAddress = userDeliveryAddresses.find(
      (address) => address.isDefault
    );
    if (defaultAddress) {
      await DeliveryAddressModel.findOneAndUpdate(
        { _id: defaultAddress._id },
        { isDefault: false }
      );
    }

    const deliveryAddress = await DeliveryAddressModel.findOneAndUpdate(
      { _id: address_id, user: authUser._id },
      { isDefault: true },
      { new: true }
    );
    return res.status(200).send({ data: deliveryAddress });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const getDeliveryAddress = async (req, res) => {
  try {
    const { address_id } = req.query;
    if (!address_id) {
      return res.status(400).send({ error: "required address_id" });
    }

    const authUser = await getAuthUser(req);
    if (!authUser) {
      return res.status(400).send({ error: "User not found" });
    }

    const deliveryAddress = await DeliveryAddressModel.findOne({
      _id: address_id,
      user: authUser._id,
    });
    return res.status(200).send({ data: deliveryAddress });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

module.exports = {
  createDeliveryAddress,
  getDeliveryAddresses,
  getDeliveryAddress,
  updateDeliveryAddress,
  deleteDeliveryAddress,
  setDefaultDeliveryAddress,
};
