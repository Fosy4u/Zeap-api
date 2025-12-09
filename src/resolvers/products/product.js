const {
  genderEnums,
  ageGroupEnums,
  ageRangeEnums,
  shoeTypeEnums,
  productTypeEnums,
  statusEnums,
  sleeveLengthEnums,
  fasteningEnums,
  occasionEnums,
  fitEnums,
  brandEnums,
  colorEnums,
  clothStyleEnums,
  designEnums,
  clothSizeEnums,
  mainEnums,
  shoeStyleEnums,
  heelHightEnums,
  heelTypeEnums,
  shoeSizeEnums,
  accessoryTypeEnums,
  accessoryStyleEnums,
  accessorySizeEnums,
  currencyEnums,
  searchQueryAllowedPaths,
  sizeStandardEnums,
} = require("../../helpers/constants");
const {
  checkForDuplicates,
  deleteLocalFile,
  getBodyMeasurementEnumsFromGuide,
  currencyCoversion,
} = require("../../helpers/utils");
const ShopModel = require("../../models/shop");
const { v4: uuidv4 } = require("uuid");
const sharp = require("sharp");
const path = require("path");
const {
  editReadyMadeClothes,
  validateReadyMadeClothes,
  addVariationToReadyMadeClothes,
} = require("./readyMadeClothes");
const { storageRef } = require("../../config/firebase");
const root = require("../../../root");
const { getAuthUser } = require("../../middleware/firebaseUserAuth");
const {
  getDynamicFilters,
  getQuery,
  addPreferredAmountAndCurrency,
} = require("./productHelpers");
const ProductModel = require("../../models/products");
const {
  editReadyMadeShoes,
  validateReadyMadeShoes,
  addVariationToReadyMadeShoes,
} = require("./readyMadeShoes");
const {
  editAccessories,
  validateAccessories,
  addVariationToAccesories,
} = require("./accessory");
const PromoModel = require("../../models/promo");
const {
  editBespokeClothes,
  addVariationToBespokeCloth,
  validateBespokeClothes,
} = require("./BespokeClothes");
const {
  editBespokeShoes,
  addVariationToBespokeShoe,
  validateBespokeShoes,
} = require("./bespokeShoes");
const {
  notifyShop,
  sendPushAllAdmins,
  addNotification,
} = require(".././notification");
const ReviewModel = require("../../models/review");
const ProductOrderModel = require("../../models/productOrder");
const { all } = require("axios");
const { type } = require("os");
const { addRecentView } = require("../recentviews");
const RecentViewsModel = require("../../models/recentViews");
const { min } = require("lodash");

//saving image to firebase storage
const addImage = async (destination, filename) => {
  let url = {};
  if (filename) {
    const source = path.join(root + "/uploads/" + filename);
    await sharp(source)
      .resize(1500, 1500, {
        fit: "inside",
        withoutEnlargement: true,
      })
      // .jpeg({ quality: 90 })
      .toFile(path.resolve(destination, "resized", filename));

    const storage = await storageRef.upload(
      path.resolve(destination, "resized", filename),
      // path.resolve(source),
      {
        public: true,
        destination: `/product/${filename}`,
        metadata: {
          firebaseStorageDownloadTokens: uuidv4(),
        },
      }
    );
    url = {
      link: storage[0].metadata.mediaLink,
      name: filename,
    };
    const deleteSourceFile = await deleteLocalFile(source);
    const deleteResizedFile = await deleteLocalFile(
      path.resolve(destination, "resized", filename)
    );
    await Promise.all([deleteSourceFile, deleteResizedFile]);
    return url;
  }
  return url;
};

const deleteImageFromFirebase = async (name) => {
  if (name) {
    storageRef
      .file("/product/" + name)
      .delete()
      .then(() => {
        return true;
      })
      .catch((err) => {
        return false;
      });
  }
};

const handleImageUpload = async (files) => {
  const newPictures = [];
  if (files) {
    for (let i = 0; i < files?.length; i++) {
      const file = files[i];

      const filename = file.filename;
      const destination = file.destination;
      // const originalname = file.originalname;

      const url = await addImage(destination, filename);

      newPictures.push(url);
    }
  }

  return newPictures;
};

const handleImageDelete = async (images) => {
  if (images) {
    for (let i = 0; i < images?.length; i++) {
      const image = images[i];
      const name = image.name;
      await deleteImageFromFirebase(name);
    }
  }
};
const deleLocalImages = async (files) => {
  for (let i = 0; i < files?.length; i++) {
    const file = files[i];
    const source = path.join(root + "/uploads/" + file.filename);

    const deleteSourceFile = await deleteLocalFile(source);
  }
};
const addProductColorAndImages = async (req, res) => {
  try {
    const files = req.files?.images;
    if (req.fileValidationError) {
      await deleLocalImages(files);

      return res.status(400).send({ error: req.fileValidationError });
    }
    if (!files || files.length === 0) {
      await deleLocalImages(files);
      return res
        .status(400)
        .send({ error: "pictures are required for each color" });
    }
    //if files is more than 5
    if (files?.length > 5) {
      await deleLocalImages(files);
      return res.status(400).send({
        error: "You can only upload a maximum of 5 images for each color",
      });
    }

    const { productId, color, currentStep } = req.body;

    if (!productId) {
      await deleLocalImages(files);
      return res.status(400).send({ error: "productId is required" });
    }
    const product = await ProductModel.findOne({ productId }).exec();
    if (!product) {
      await deleLocalImages(files);
      return res.status(400).send({ error: "product not found" });
    }
    const productType = product.productType;
    if (productType !== "bespokeCloth" && productType !== "bespokeShoe") {
      if (!color) {
        await deleLocalImages(files);
        return res.status(400).send({ error: "color is required" });
      }

      if (colorEnums.findIndex((c) => c?.name === color) === -1) {
        await deleLocalImages(files);
        return res.status(400).send({ error: "invalid color value" });
      }

      // check if color already exist

      const colorExist = product.colors.find((c) => c.value === color);
      if (colorExist) {
        await deleLocalImages(files);
        return res.status(400).send({ error: "color already exist" });
      }
    }

    const user = await getAuthUser(req);
    if (user.shopId !== product.shopId && !user?.isAdmin && !user?.superAdmin) {
      await deleLocalImages(files);
      return res
        .status(400)
        .send({ error: "You are not authorized to edit this product" });
    }
    if (!files || files.length === 0) {
      await deleLocalImages(files);
      return res
        .status(400)
        .send({ error: "pictures are required for each color" });
    }

    let images = [{}];

    if (files && files.length > 0) {
      const upload = await handleImageUpload([...files]);

      const docs = await Promise.all(upload);
      images = docs;
    }

    const colors = product.colors;
    //array of color images
    const colorImages = colors.map((color) => color.images).flat();

    //check if any image is isDefault
    const isDefault = colorImages.find((image) => image.isDefault);
    if (isDefault) {
      images[0].isDefault = false;
    } else {
      images[0].isDefault = true;
    }

    const newColor = {
      value:
        productType === "bespokeCloth" || productType === "bespokeShoe"
          ? "Bespoke"
          : color,
      images,
    };

    const updatedProduct = await ProductModel.findOneAndUpdate(
      { productId },
      {
        $push: { colors: newColor },
        currentStep: currentStep || product.currentStep,
      },

      { new: true }
    ).exec();

    if (!updatedProduct) {
      await handleImageDelete(images);
      return res.status(400).send({ error: "product not found" });
    }
    return res
      .status(200)
      .send({ data: updatedProduct, message: "product updated successfully" });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const addImagesToProductColor = async (req, res) => {
  try {
    const files = req.files?.images;
    if (req.fileValidationError) {
      await deleLocalImages(files);

      return res.status(400).send({ error: req.fileValidationError });
    }
    if (!files || files.length === 0) {
      await deleLocalImages(files);
      return res
        .status(400)
        .send({ error: "pictures are required for each color" });
    }

    //if files is more than 5
    if (files.length > 5) {
      await deleLocalImages(files);
      return res.status(400).send({
        error: "You can only upload a maximum of 5 images for each color",
      });
    }

    const { productId, color } = req.body;
    if (!productId) {
      await deleLocalImages(files);
      return res.status(400).send({ error: "productId is required" });
    }

    if (!color) {
      await deleLocalImages(files);
      return res.status(400).send({ error: "color is required" });
    }

    if (
      color.toLowerCase() !== "bespoke" &&
      colorEnums.findIndex((c) => c?.name === color) === -1
    ) {
      await deleLocalImages(files);
      return res.status(400).send({ error: "invalid color value" });
    }

    const product = await ProductModel.findOne({ productId }).exec();
    if (!product) {
      await deleLocalImages(files);
      return res.status(400).send({ error: "product not found" });
    }
    // check if color already exist

    const colorExist = product.colors.find((c) => c.value === color);
    if (!colorExist) {
      await deleLocalImages(files);
      return res.status(400).send({ error: "color not found" });
    }
    const user = await getAuthUser(req);
    if (user.shopId !== product.shopId && !user?.isAdmin && !user?.superAdmin) {
      await deleLocalImages(files);
      return res
        .status(400)
        .send({ error: "You are not authorized to edit this product" });
    }
    const previousImages = colorExist.images;
    if ([...previousImages, ...files].length > 5) {
      await deleLocalImages(files);
      return res.status(400).send({
        error: "You can only upload a maximum of 5 images for each color",
      });
    }

    let images = [{}];

    if (files && files.length > 0) {
      const upload = await handleImageUpload([...files]);

      const docs = await Promise.all(upload);
      images = docs;
    }
    const colors = product.colors;
    //array of color images
    const colorImages = colors.map((color) => color.images).flat();

    //check if any image is isDefault
    const isDefault = colorImages.find((image) => image.isDefault);
    if (!isDefault) {
      images[0].isDefault = true;
    }

    const updatedProduct = await ProductModel.findOneAndUpdate(
      { productId, "colors.value": color },
      { $push: { "colors.$.images": images } },
      { new: true }
    ).exec();

    if (!updatedProduct) {
      await handleImageDelete(images);
      return res.status(400).send({ error: "product not found" });
    }
    return res
      .status(200)
      .send({ data: updatedProduct, message: "product updated successfully" });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const deleteProductColor = async (req, res) => {
  try {
    const { productId, color } = req.body;
    if (!productId) {
      return res.status(400).send({ error: "productId is required" });
    }
    if (!color) {
      return res.status(400).send({ error: "color is required" });
    }
    const product = await ProductModel.findOne({ productId }).exec();
    if (!product) {
      return res.status(400).send({ error: "product not found" });
    }
    const user = await getAuthUser(req);
    if (user.shopId !== product.shopId && !user?.isAdmin && !user?.superAdmin) {
      return res
        .status(400)
        .send({ error: "You are not authorized to edit this product" });
    }
    const colors = product.colors;
    const colorExist = colors.find((c) => c.value === color);
    if (!colorExist) {
      return res.status(400).send({ error: "color not found" });
    }
    const colorImages = colorExist.images;
    const images = colorImages.map((image) => image.name);
    const isDefault = colorImages.find((image) => image.isDefault);
    if (isDefault && colors.length > 1) {
      return res.status(400).send({
        error:
          "There is a default image for this color. set another image as default before deleting this color",
      });
    }
    const updatedProduct = await ProductModel.findOneAndUpdate(
      { productId },
      { $pull: { colors: { value: color } } },
      { new: true }
    ).exec();

    if (!updatedProduct) {
      return res.status(400).send({ error: "product not found" });
    }
    await handleImageDelete(colorImages);
    return res
      .status(200)
      .send({ data: updatedProduct, message: "product updated successfully" });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const deleteProductImage = async (req, res) => {
  try {
    const { productId, color, imageName } = req.body;
    if (!productId) {
      return res.status(400).send({ error: "productId is required" });
    }
    if (!color) {
      return res.status(400).send({ error: "color is required" });
    }
    if (!imageName) {
      return res
        .status(400)
        .send({ error: "name of the image you want to delete is required" });
    }
    const product = await ProductModel.findOne({ productId }).exec();
    if (!product) {
      return res.status(400).send({ error: "product not found" });
    }
    const user = await getAuthUser(req);
    if (user.shopId !== product.shopId && !user?.isAdmin && !user?.superAdmin) {
      return res
        .status(400)
        .send({ error: "You are not authorized to edit this product" });
    }
    const colors = product.colors;
    const colorExist = colors.find((c) => c.value === color);
    if (!colorExist) {
      return res.status(400).send({ error: "color not found" });
    }
    const colorImages = colorExist.images;
    const imageExist = colorImages.find((image) => image.name === imageName);
    if (!imageExist) {
      return res.status(400).send({ error: "image not found" });
    }
    const isDefault = imageExist.isDefault;
    if (isDefault && (colorImages.length > 1 || colors.length > 1)) {
      return res.status(400).send({
        error:
          "This is a default image for this product. set another image as default before deleting this image",
      });
    }
    const updatedProduct = await ProductModel.findOneAndUpdate(
      { productId, "colors.value": color },
      { $pull: { "colors.$.images": { name: imageName } } },
      { new: true }
    ).exec();

    if (!updatedProduct) {
      return res.status(400).send({ error: "product not found" });
    }
    await deleteImageFromFirebase(imageName);
    return res
      .status(200)
      .send({ data: updatedProduct, message: "product updated successfully" });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const setProductImageAsDefault = async (req, res) => {
  try {
    const { productId, color, imageName } = req.body;
    if (!productId) {
      return res.status(400).send({ error: "productId is required" });
    }
    if (!color) {
      return res.status(400).send({ error: "color is required" });
    }
    if (!imageName) {
      return res.status(400).send({
        error: "name of the image you want to set as default is required",
      });
    }
    const product = await ProductModel.findOne({ productId }).exec();
    if (!product) {
      return res.status(400).send({ error: "product not found" });
    }
    const user = await getAuthUser(req);
    if (user.shopId !== product.shopId && !user?.isAdmin && !user?.superAdmin) {
      return res
        .status(400)
        .send({ error: "You are not authorized to edit this product" });
    }
    const colors = product.colors;
    const colorExist = colors.find((c) => c.value === color);
    if (!colorExist) {
      return res.status(400).send({ error: "color not found" });
    }
    const colorImages = colorExist.images;
    const imageExist = colorImages.find((image) => image.name === imageName);
    if (!imageExist) {
      return res.status(400).send({ error: "image not found" });
    }
    if (imageExist.isDefault) {
      return res
        .status(400)
        .send({ error: "This image is already set as default" });
    }
    // set all other images as not default
    const newColors = colors.map((c) => {
      if (c.value === color) {
        c.images = c.images.map((image) => {
          if (image.name === imageName) {
            image.isDefault = true;
          } else {
            image.isDefault = false;
          }
          return image;
        });
      }
      return c;
    });
    const updatedProduct = await ProductModel.findOneAndUpdate(
      { productId },
      { colors: newColors },
      { new: true }
    ).exec();

    if (!updatedProduct) {
      return res.status(400).send({ error: "product not found" });
    }
    return res
      .status(200)
      .send({ data: updatedProduct, message: "product updated successfully" });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

const editProduct = async (req, res) => {
  try {
    const { productId, title, description, status } = req.body;

    if (!productId) {
      return res.status(400).send({ error: "productId is required" });
    }
    const product = await ProductModel.findOne({ productId }).exec();
    if (!product) {
      return res.status(400).send({ error: "product not found" });
    }
    if (req.body.productType && req.body.productType !== product.productType) {
      return res.status(400).send({
        error:
          "productType cannot be edited. delete and create a new product with correct product type instead",
      });
    }
    if (req.body.shopId && req.body.shopId !== product.shopId) {
      return res.status(400).send({
        error:
          "shopId cannot be edited. delete and create a new product with correct shopId instead",
      });
    }

    if (title && title == "") {
      return res.status(400).send({ error: "title is required" });
    }
    if (description && description == "") {
      return res.status(400).send({ error: "description is required" });
    }
    const user = await getAuthUser(req);
    if (user.shopId !== product.shopId && !user?.isAdmin && !user?.superAdmin) {
      return res
        .status(400)
        .send({ error: "You are not authorized to edit this product" });
    }
    if (product?.status !== "draft" && product?.status !== "rejected") {
      return res.status(400).send({
        error:
          "You can only edit a product that is in draft or rejected status",
      });
    }
    if (status) {
      return res.status(400).send({
        error: "You are not authorized to directly change the status here",
      });
    }

    if (req.body?.postedBy) {
      return res
        .status(400)
        .send({ error: "You are not authorized to change the postedBy" });
    }
    if (req.body?.shop) {
      return res
        .status(400)
        .send({ error: "You are not authorized to change the shop" });
    }

    const productType = product.productType;
    let updatedProduct;
    if (productType === "readyMadeCloth") {
      updatedProduct = await editReadyMadeClothes(req);
    }
    if (productType === "readyMadeShoe") {
      updatedProduct = await editReadyMadeShoes(req);
    }
    if (productType === "accessory") {
      updatedProduct = await editAccessories(req);
    }
    if (productType === "bespokeCloth") {
      updatedProduct = await editBespokeClothes(req);
    }
    if (productType === "bespokeShoe") {
      updatedProduct = await editBespokeShoes(req);
    }
    if (updatedProduct?.error) {
      return res.status(400).send({ error: updatedProduct.error });
    }
    return res
      .status(200)
      .send({ data: updatedProduct, message: "product updated successfully" });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const deleteProducts = async (req, res) => {
  try {
    const param = req.body;
    const { productIds } = param;
    if (!productIds || !productIds.length) {
      return res.status(400).send({ error: "productid is required" });
    }
    //check all products exist
    const products = await ProductModel.find({
      productId: { $in: productIds },
    }).exec();
    if (products.length !== productIds.length) {
      return res.status(400).send({ error: "one or more products not found" });
    }
    const user = await getAuthUser(req);
    const shopIds = products.map((product) => product.shopId);
    const shopId = shopIds[0];
    if (
      shopIds.some((id) => id !== shopId && !user?.isAdmin && !user?.superAdmin)
    ) {
      return res
        .status(400)
        .send({ error: "You can only delete products from the same shop" });
    }
    if (user.shopId !== shopId && !user?.isAdmin && !user?.superAdmin) {
      return res.status(400).send({
        error: "You are not authorized to delete products from this shop",
      });
    }
    const newTimeline = {
      date: new Date(),
      description: "product deleted",
      actionBy: user._id,
    };
    const promises = [];
    productIds.forEach((productId) => {
      promises.push(
        ProductModel.findOneAndUpdate(
          {
            productId,
          },
          {
            status: "deleted",
            disabled: true,
            $push: { timeLine: newTimeline },
          },
          { new: true }
        )
      );
    });
    await Promise.all(promises);
    return res.status(200).send({ message: "products deleted successfully" });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

const restoreProducts = async (req, res) => {
  try {
    const param = req.body;
    const { productIds } = param;
    if (!productIds || !productIds.length) {
      return res.status(400).send({ error: "productid is required" });
    }
    //check all products exist
    const products = await ProductModel.find({
      productId: { $in: productIds },
    }).exec();
    if (products.length !== productIds.length) {
      return res.status(400).send({ error: "one or more products not found" });
    }
    const user = await getAuthUser(req);
    const shopIds = products.map((product) => product.shopId);
    const shopId = shopIds[0];
    if (
      shopIds.some((id) => id !== shopId && !user?.isAdmin && !user?.superAdmin)
    ) {
      return res
        .status(400)
        .send({ error: "You can only restore products from the same shop" });
    }
    if (user.shopId !== shopId && !user?.isAdmin && !user?.superAdmin) {
      return res.status(400).send({
        error: "You are not authorized to restore products from this shop",
      });
    }
    const newTimeline = {
      date: new Date(),
      description: "product restored",
      actionBy: user._id,
    };
    const promises = [];
    productIds.forEach((productId) => {
      promises.push(
        ProductModel.findOneAndUpdate(
          {
            productId,
          },
          {
            status: "draft",
            disabled: false,
            $push: { timeLine: newTimeline },
          },
          { new: true }
        )
      );
    });
    await Promise.all(promises);
    return res.status(200).send({ message: "products restored successfully" });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
function getRandomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}
const getProuctTypePrefix = (productType) => {
  if (productType === "readyMadeCloth") {
    return "RMC";
  }
  if (productType === "readyMadeShoe") {
    return "RMS";
  }
  if (productType === "accessory") {
    return "ACC";
  }
  if (productType === "bespokeCloth") {
    return "BSC";
  }
  if (productType === "bespokeShoe") {
    return "BSS";
  }
  return "OTH";
};
const generateProductId = async (shopId, productType) => {
  let productId = "";
  let found = true;

  do {
    productId = `${shopId}/${getProuctTypePrefix(productType)}/${getRandomInt(
      1000000,
      9999999
    )}`;
    const exist = await ProductModel.findOne({ productId }, { lean: true });
    if (exist) {
      found = true;
    } else {
      found = false;
    }
  } while (found);
  return productId;
};

const createProduct = async (req, res) => {
  try {
    const { productType, title, description, subTitle, shopId } = req.body;

    if (!productType) {
      return res.status(400).send({ error: "Product Type is required" });
    }
    if (productTypeEnums.indexOf(productType) === -1) {
      return res.status(400).send({ error: "invalid productType" });
    }
    if (!title) {
      return res.status(400).send({ error: "title is required" });
    }

    if (!description) {
      return res.status(400).send({ error: "description is required" });
    }

    const user = await getAuthUser(req);
    if (
      shopId &&
      user.shopId !== shopId &&
      !user?.isAdmin &&
      !user?.superAdmin
    ) {
      return res.status(400).send({
        error: "You are not authorized to create product for this shop",
      });
    }

    if (!user?.shopId && !shopId) {
      return res.status(400).send({ error: "User does not have a shop" });
    }
    if (!user?.shopEnabled && !user?.isAdmin && !user?.superAdmin) {
      return res.status(400).send({ error: "User's shop is disabled" });
    }
    const shop = await ShopModel.findOne({ shopId: shopId || user.shopId });
    if (!shop) {
      return res.status(400).send({ error: "shop not found" });
    }
    if (shop?.disabled) {
      return res.status(400).send({ error: "shop is disabled" });
    }

    const productId = await generateProductId(
      shopId || user.shopId,
      productType
    );
    const timeLine = [
      {
        date: new Date(),
        description: "product created and status set to draft",
        actionBy: user._id,
      },
    ];
    const readyMadeProductTypeEnums = ["readyMadeCloth", "readyMadeShoe"];
    const bespokeProductTypeEnums = ["bespokeCloth", "bespokeShoe"];
    const param = {
      title,
      subTitle,
      description,
      productType,
      shopId: shopId || user.shopId,
      isBespoke: bespokeProductTypeEnums.includes(productType),
      isReadyMade: readyMadeProductTypeEnums.includes(productType),
      productId,
      postedBy: user._id,
      shop: shop._id,
      status: "draft",
      timeLine,
    };

    const product = new ProductModel(param);
    const savedProduct = await product.save();
    return res
      .status(200)
      .send({ data: savedProduct, message: "product created successfully" });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const setProductStatus = async (req, res) => {
  try {
    const { productId, status, rejectionReasons } = req.body;

    if (!productId) {
      return res.status(400).send({ error: "productId is required" });
    }

    if (statusEnums.indexOf(status) === -1) {
      return res.status(400).send({ error: "invalid status" });
    }
    if (status === "deleted") {
      return res.status(400).send({
        error:
          "You cannot set product status to deleted. use delete product instead",
      });
    }
    const product = await ProductModel.findOne({ productId }).exec();
    if (!product) {
      return res.status(400).send({ error: "product not found" });
    }
    if (status === product?.status) {
      return res
        .status(400)
        .send({ error: "product status is already set to " + status });
    }
    if (product?.status === "deleted") {
      return res
        .status(400)
        .send({ error: "You cannot set status for a deleted product" });
    }
    if (status === "live" && product?.status !== "under review") {
      return res.status(400).send({
        error: "You can only set product status to live if it is under review",
      });
    }

    const user = await getAuthUser(req);
    if (user.shopId !== product.shopId && !user?.isAdmin && !user?.superAdmin) {
      return res
        .status(400)
        .send({ error: "You are not authorized to edit this product" });
    }
    if (
      status === "rejected" &&
      (!rejectionReasons || rejectionReasons?.length === 0)
    ) {
      return res.status(400).send({ error: "rejectionReason(s) is required" });
    }

    const productType = product.productType;
    if (status === "under review" && productType === "readyMadeCloth") {
      const verify = await validateReadyMadeClothes(product);

      if (verify.error) {
        return res.status(400).send({ error: verify.error });
      }
    }
    if (status === "under review" && productType === "readyMadeShoe") {
      const verify = await validateReadyMadeShoes(product);
      if (verify.error) {
        return res.status(400).send({ error: verify.error });
      }
    }
    if (status === "under review" && productType === "accessory") {
      const verify = await validateAccessories(product);
      if (verify) {
        return res.status(400).send({ error: verify.error });
      }
    }

    let updatedRejectedReasons = product.rejectionReasons;
    if (status === "rejected") {
      updatedRejectedReasons = rejectionReasons;
    } else {
      updatedRejectedReasons = [];
    }
    const newTimeLine = {
      date: new Date(),
      description: `product status set to ${status}`,
      actionBy: user._id,
    };
    const updatedProduct = await ProductModel.findOneAndUpdate(
      { productId },
      {
        status,
        rejectionReasons: updatedRejectedReasons,
        $push: { timeLine: newTimeLine },
      },
      { new: true }
    ).exec();

    return res.status(200).send({
      data: updatedProduct,
      message: "product status updated successfully",
    });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const submitProduct = async (req, res) => {
  try {
    const { productId } = req.body;

    if (!productId) {
      return res.status(400).send({ error: "productId is required" });
    }
    const product = await ProductModel.findOne({ productId }).exec();
    if (!product) {
      return res.status(400).send({ error: "product not found" });
    }
    const productType = product.productType;

    if (productType === "readyMadeCloth") {
      const verify = await validateReadyMadeClothes(product);
      if (verify?.error) {
        return res.status(400).send({ error: verify.error });
      }
    }
    if (productType === "readyMadeShoe") {
      const verify = await validateReadyMadeShoes(product);
      if (verify?.error) {
        return res.status(400).send({ error: verify.error });
      }
    }
    if (productType === "bespokeCloth") {
      const verify = await validateBespokeClothes(product);
      if (verify?.error) {
        return res.status(400).send({ error: verify.error });
      }
    }
    if (productType === "bespokeShoe") {
      const verify = await validateBespokeShoes(product);
      if (verify?.error) {
        return res.status(400).send({ error: verify.error });
      }
    }
    if (productType === "accessory") {
      const verify = await validateAccessories(product);
      if (verify?.error) {
        return res.status(400).send({ error: verify.error });
      }
    }
    const user = await getAuthUser(req);
    const newTimeLine = {
      date: new Date(),
      description: "product submitted for review",
      actionBy: user._id,
    };
    const updatedProduct = await ProductModel.findOneAndUpdate(
      { productId },
      { status: "under review", $push: { timeLine: newTimeLine } },
      { new: true }
    ).exec();
    if (!updatedProduct) {
      return res.status(400).send({ error: "product not found" });
    }
    const title = "Order Item Status Update";
    const body = `Order item with productId ${productId} has been set to under review`;
    const image = updatedProduct?.colors[0]?.images[0]?.link;
    const shop_id = updatedProduct?.shop.toString();

    if (shop_id) {
      const notifyShopParam = { shop_id, title, body, image };

      const notify = await notifyShop(notifyShopParam);
    }
    const pushAllAdmins = await sendPushAllAdmins(title, body, image);
    const notificationParam = {
      title,
      body,
      image,
      isAdminPanel: true,
    };
    const addAdminNotification = await addNotification({
      notificationParam,
    });
    return res.status(200).send({
      data: updatedProduct,
      message: "product submitted successfully",
    });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

const getProduct = async (req, res) => {
  try {
    const { productId } = req.query;
    if (!productId) {
      return res.status(400).send({ error: "productId is required" });
    }
    let showReadyMadeSizeGuide = false;
    let showBespokeSizeGuide = false;
    const productData = await ProductModel.findOne({ productId })
      .populate("shop")
      .populate("postedBy")
      .populate("timeLine.actionBy")
      .lean();
    if (!productData) {
      return res.status(400).send({ error: "product not found" });
    }
    const authUser = await getAuthUser(req);
    const currency = req.query.currency || authUser?.prefferedCurrency || "NGN";
    const addCurrency = await addPreferredAmountAndCurrency(
      [productData],
      currency
    );
    const product = addCurrency[0];
    if (product?.status === "live" && !authUser.isGuest) {
      const updateRecentView = await addRecentView(product._id, authUser._id);
    }

    const productType = product.productType;
    if (productType === "readyMadeCloth" || productType === "readyMadeShoe") {
      showReadyMadeSizeGuide = true;
    }
    if (productType === "bespokeCloth" || productType === "bespokeShoe") {
      showBespokeSizeGuide = true;
    }
    product.showReadyMadeSizeGuide = showReadyMadeSizeGuide;
    product.showBespokeSizeGuide = showBespokeSizeGuide;

    return res.status(200).send({ data: product });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const getProductById = async (req, res) => {
  try {
    const { _id } = req.query;
    if (!_id) {
      return res.status(400).send({ error: "_id is required" });
    }
    const productData = await ProductModel.findById(_id)
      .populate("shop")
      .populate("postedBy")
      .populate("bodyMeasurement")
      .populate("timeLine.actionBy")
      .lean();
    if (!productData) {
      return res.status(400).send({ error: "product not found" });
    }

    const authUser = await getAuthUser(req);
    const currency = req.query.currency || authUser?.prefferedCurrency || "NGN";
    const addCurrency = await addPreferredAmountAndCurrency(
      [productData],
      currency
    );
    const product = addCurrency[0];

    return res.status(200).send({ data: product });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

const getShopProducts = async (req, res) => {
  try {
    const { shopId } = req.query;
    if (!shopId) {
      return res.status(400).send({ error: "shopId is required" });
    }
    const productsData = await ProductModel.find({ shopId })
      .populate("shop")
      .populate("postedBy")
      .exec();

    const authUser = await getAuthUser(req);
    const currency = req.query.currency || authUser?.prefferedCurrency || "NGN";
    const products = await addPreferredAmountAndCurrency(
      productsData,
      currency
    );
    return res.status(200).send({ data: products });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const getCategoryProducts = async (req, res) => {
  try {
    const { category } = req.query;
    if (!category) {
      return res.status(400).send({ error: "category is required" });
    }
    const productsData = await ProductModel.find({ category, status: "live" })
      .populate("shop")
      .populate("postedBy")
      .lean();
    if (!productsData) {
      return res.status(400).send({ error: "products not found" });
    }
    const authUser = await getAuthUser(req);
    const currency = req.query.currency || authUser?.prefferedCurrency || "NGN";
    const products = await addPreferredAmountAndCurrency(
      productsData,
      currency
    );
    const dynamicFilters = getDynamicFilters(products);
    const data = {
      products,
      dynamicFilters,
    };
    return res.status(200).send({ data: data });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const getProducts = async (req, res) => {
  try {
    const sort = req.query.sort || -1;
    const limit = parseInt(req.query.limit);
    const pageNumber = parseInt(req.query.pageNumber);
    if (!limit) {
      return res.status(400).send({
        error: "limit is required. This is maximum number you want per page",
      });
    }

    if (!pageNumber) {
      return res.status(400).send({
        error:
          "pageNumber is required. This is the current page number in the pagination",
      });
    }
    if (sort !== -1 && sort !== 1) {
      return res.status(400).send({ error: "sort value can only be 1 or -1" });
    }
    const user = await getAuthUser(req);
    if (!user?.isAdmin && !user?.superAdmin) {
      return res
        .status(400)
        .send({ error: "You are not authorized to view all products" });
    }
    const query = getQuery(req.query);
    const aggregate = [
      {
        $facet: {
          products: [
            { $match: { ...query } },
            { $sort: { createdAt: sort } },
            { $skip: limit * (pageNumber - 1) },
            { $limit: limit },
          ],
          allProducts: [
            { $match: { ...query } },
            {
              $project: {
                productType: 1,
                categories: 1,
                sizes: 1,
                colors: 1,
                variations: 1,
              },
            },
          ],
        },
      },
    ];
    const productQuery = await ProductModel.aggregate(aggregate).exec();
    const products = productQuery[0].products;
    const allProducts = productQuery[0].allProducts;
    const totalCount = allProducts?.length || 0;
    const dynamicFilters = getDynamicFilters(allProducts);

    const data = {
      products,
      totalCount,
      dynamicFilters,
    };
    return res.status(200).send({ data: data });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const getAuthShopProducts = async (req, res) => {
  try {
    const sort = req.query.sort || -1;
    const limit = parseInt(req.query.limit);
    const pageNumber = parseInt(req.query.pageNumber);
    if (!limit) {
      return res.status(400).send({
        error: "limit is required. This is maximum number you want per page",
      });
    }

    if (!pageNumber) {
      return res.status(400).send({
        error:
          "pageNumber is required. This is the current page number in the pagination",
      });
    }
    if (sort !== -1 && sort !== 1) {
      return res.status(400).send({ error: "sort value can only be 1 or -1" });
    }
    const user = await getAuthUser(req);

    const query = getQuery(req.query);
    const authShop = await ShopModel.findOne({ user: user._id }).exec();
    if (!authShop) {
      return res.status(400).send({ error: "shop not found" });
    }
    query.shopId = authShop.shopId;
    const aggregate = [
      {
        $facet: {
          products: [
            { $match: { ...query } },
            { $sort: { createdAt: sort } },
            { $skip: limit * (pageNumber - 1) },
            { $limit: limit },
          ],
          allProducts: [
            { $match: { ...query } },
            {
              $project: {
                productType: 1,
                categories: 1,
                sizes: 1,
                colors: 1,
                variations: 1,
              },
            },
          ],
        },
      },
    ];
    const productQuery = await ProductModel.aggregate(aggregate).exec();
    const currency = req.query.currency || user?.prefferedCurrency || "NGN";
    const productsData = productQuery[0].products;
    const products = await addPreferredAmountAndCurrency(
      productsData,
      currency
    );
    const allProducts = productQuery[0].allProducts;
    const totalCount = allProducts?.length || 0;
    const dynamicFilters = getDynamicFilters(allProducts);

    const data = {
      products,
      totalCount,
      dynamicFilters,
    };
    return res.status(200).send({ data: data });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const getLiveProducts = async (req, res) => {
  try {
    if (req.query.currency) {
      const isValid = currencyEnums.includes(req.query.currency);
      if (!isValid) {
        return res.status(400).send({ error: "invalid currency" });
      }
    }
    const limit = parseInt(req.query.limit);
    const pageNumber = parseInt(req.query.pageNumber);
    if (!limit) {
      return res.status(400).send({
        error: "limit is required. This is maximum number you want per page",
      });
    }

    if (!pageNumber) {
      return res.status(400).send({
        error:
          "pageNumber is required. This is the current page number in the pagination",
      });
    }
    const sort = req.query.sort || -1;
    if (sort !== -1 && sort !== 1) {
      return res.status(400).send({ error: "sort value can only be 1 or -1" });
    }
    const query = getQuery(req.query);
    query.status = "live";

    const aggregate = [
      {
        $facet: {
          products: [
            { $match: { ...query } },
            { $sort: { createdAt: sort } },
            { $skip: limit * (pageNumber - 1) },
            { $limit: limit },
          ],

          allProducts: [
            { $match: { ...query } },
            {
              $project: {
                productType: 1,
                categories: 1,
                sizes: 1,
                colors: 1,
                variations: 1,
              },
            },
          ],
        },
      },
    ];

    const productQuery = await ProductModel.aggregate(aggregate).exec();
    const authUser = await getAuthUser(req);
    const currency = req.query.currency || authUser?.prefferedCurrency || "NGN";
    const productsData = productQuery[0].products;
    const products = await addPreferredAmountAndCurrency(
      productsData,
      currency
    );

    const allProducts = productQuery[0].allProducts;

    const totalCount = allProducts?.length || 0;
    const dynamicFilters = getDynamicFilters(allProducts);
    const data = {
      products,
      totalCount,
      dynamicFilters,
    };

    return res.status(200).send({ data: data });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const getLiveProductsLeastPrice = async (req, res) => {
  try {
    const query = getQuery(req.query);
    query.status = "live";
    // sort by variations.discount if its more than zero, else sort by variations.price

    const productQuery = await ProductModel.find(query).select("variations");
    const products = [];
    productQuery.forEach((product) => {
      const productId = product.productId;
      if (product?.variations && product?.variations.length > 0) {
        const minPrice = product.variations.reduce((min, variation) => {
          const price =
            variation.discount > 0 ? variation.discount : variation.price;
          return price < min ? price : min;
        }, Infinity);
        products.push({
          minPrice: minPrice,
        });
      }
    });
    products.sort((a, b) => a.minPrice - b.minPrice);

    const authUser = await getAuthUser(req);
    const currency = req.query.currency || authUser?.prefferedCurrency || "NGN";

    const minPrice = products[0]?.minPrice || 0;

    const convertedAmount = await currencyCoversion(minPrice, currency);

    if (convertedAmount.error) {
      return res.status(400).send({ error: convertedAmount.error });
    }
    const data = {
      minPrice: convertedAmount,
      currency: currency,
    };

    return res.status(200).send({ data: data });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const getPromoWithLiveProducts = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit);
    const pageNumber = parseInt(req.query.pageNumber);
    const { promoId } = req.query;
    if (!limit) {
      return res.status(400).send({
        error: "limit is required. This is maximum number you want per page",
      });
    }

    if (!pageNumber) {
      return res.status(400).send({
        error:
          "pageNumber is required. This is the current page number in the pagination",
      });
    }
    const sort = req.query.sort || -1;
    if (sort !== -1 && sort !== 1) {
      return res.status(400).send({ error: "sort value can only be 1 or -1" });
    }
    if (!promoId) {
      return res.status(400).send({ error: "promoId is required" });
    }
    const promo = await PromoModel.findOne({ promoId });
    if (!promo) {
      return res.status(400).send({ error: "Promo not found" });
    }
    const includedProducts = promo.productIds;
    const query = getQuery(req.query);
    query.status = "live";
    query.productId = { $in: includedProducts };
    const aggregate = [
      {
        $facet: {
          products: [
            { $match: { ...query } },
            { $sort: { createdAt: sort } },
            { $skip: limit * (pageNumber - 1) },
            { $limit: limit },
          ],
          allProducts: [
            { $match: { ...query } },
            {
              $project: {
                productType: 1,
                categories: 1,
                sizes: 1,
                colors: 1,
                variations: 1,
              },
            },
          ],
        },
      },
    ];
    const productQuery = await ProductModel.aggregate(aggregate).exec();
    const authUser = await getAuthUser(req);
    const currency = req.query.currency || authUser?.prefferedCurrency || "NGN";
    const productsData = productQuery[0].products;
    const products = await addPreferredAmountAndCurrency(
      productsData,
      currency
    );

    const allProducts = productQuery[0].allProducts;
    const totalCount = allProducts?.length || 0;
    const dynamicFilters = getDynamicFilters(allProducts);
    const data = {
      products,
      promo,
      totalCount,
      dynamicFilters,
    };
    return res.status(200).send({ data: data });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const getNewestArrivals = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit);
    const pageNumber = parseInt(req.query.pageNumber);
    if (!limit) {
      return res.status(400).send({
        error: "limit is required. This is maximum number you want per page",
      });
    }

    if (!pageNumber) {
      return res.status(400).send({
        error:
          "pageNumber is required. This is the current page number in the pagination",
      });
    }

    const query = getQuery(req.query);

    query.status = "live";
    const aggregate = [
      {
        $facet: {
          products: [
            { $match: { ...query } },
            { $sort: { createdAt: -1 } },
            { $skip: limit * (pageNumber - 1) },
            { $limit: limit },
          ],
          allProducts: [
            { $match: { ...query } },
            {
              $project: {
                productType: 1,
                categories: 1,
                sizes: 1,
                colors: 1,
                variations: 1,
              },
            },
          ],
        },
      },
    ];
    const productQuery = await ProductModel.aggregate(aggregate).exec();
    const authUser = await getAuthUser(req);
    const currency = req.query.currency || authUser?.prefferedCurrency || "NGN";
    const productsData = productQuery[0].products;
    const products = await addPreferredAmountAndCurrency(
      productsData,
      currency
    );
    const allProducts = productQuery[0].allProducts;
    const totalCount = allProducts?.length || 0;
    const dynamicFilters = getDynamicFilters(allProducts);
    const data = {
      products,
      totalCount,
      dynamicFilters,
    };
    return res.status(200).send({ data: data });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const getBespoke = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit);
    const pageNumber = parseInt(req.query.pageNumber);
    if (!limit) {
      return res.status(400).send({
        error: "limit is required. This is maximum number you want per page",
      });
    }

    if (!pageNumber) {
      return res.status(400).send({
        error:
          "pageNumber is required. This is the current page number in the pagination",
      });
    }

    const query = getQuery(req.query);

    query.status = "live";
    query.productType = {
      $in: ["bespokeCloth", "bespokeShoe"],
    };
    const aggregate = [
      {
        $facet: {
          products: [
            { $match: { ...query } },
            { $sort: { createdAt: -1 } },
            { $skip: limit * (pageNumber - 1) },
            { $limit: limit },
          ],
          allProducts: [
            { $match: { ...query } },
            {
              $project: {
                productType: 1,
                categories: 1,
                sizes: 1,
                colors: 1,
                variations: 1,
              },
            },
          ],
        },
      },
    ];
    const productQuery = await ProductModel.aggregate(aggregate).exec();
    const authUser = await getAuthUser(req);
    const currency = req.query.currency || authUser?.prefferedCurrency || "NGN";
    const productsData = productQuery[0].products;
    const products = await addPreferredAmountAndCurrency(
      productsData,
      currency
    );
    const allProducts = productQuery[0].allProducts;
    const totalCount = allProducts?.length || 0;
    const dynamicFilters = getDynamicFilters(allProducts);
    const data = {
      products,
      totalCount,
      dynamicFilters,
    };
    return res.status(200).send({ data: data });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const getMostPopular = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit);
    const pageNumber = parseInt(req.query.pageNumber);
    if (!limit) {
      return res.status(400).send({
        error: "limit is required. This is maximum number you want per page",
      });
    }

    if (!pageNumber) {
      return res.status(400).send({
        error:
          "pageNumber is required. This is the current page number in the pagination",
      });
    }

    const query = getQuery(req.query);
    query.status = "live";
    // get most popular products based on number of productOrders
    ProductOrderModel.aggregate([
      {
        $group: {
          _id: "$product",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: limit },
    ]).exec((err, result) => {
      if (err) {
        return res.status(500).send({ error: err.message });
      }

      const product_ids = result.map((r) => r._id);
      const aggregate = [
        {
          $facet: {
            products: [
              { $match: { ...query, _id: { $in: product_ids } } },
              { $sort: { createdAt: -1 } },
              { $skip: limit * (pageNumber - 1) },
              { $limit: limit },
            ],
            allProducts: [{ $match: { ...query } }],
          },
        },
      ];
      ProductModel.aggregate(aggregate).exec(async (err, productQuery) => {
        if (err) {
          return res.status(500).send({ error: err.message });
        }
        const authUser = await getAuthUser(req);
        const currency =
          req.query.currency || authUser?.prefferedCurrency || "NGN";

        const productsData = productQuery[0].products;
        const products = await addPreferredAmountAndCurrency(
          productsData,
          currency
        );
        const allProducts = productQuery[0].allProducts;
        const totalCount = allProducts?.length || 0;
        const dynamicFilters = getDynamicFilters(allProducts);
        const mostPopularProducts = [...products];
        if (products.length < limit) {
          const remainingLimit = limit - products.length;
          // remove products from allProducts
          const notPopularProducts = allProducts.filter(
            (p) =>
              !products.map((p) => p._id.toString()).includes(p._id.toString())
          );
          const remainingProducts = notPopularProducts.slice(0, remainingLimit);
          const remainingProductsData = await addPreferredAmountAndCurrency(
            remainingProducts,
            currency
          );
          mostPopularProducts.push(...remainingProductsData);
        }
        const data = {
          products: mostPopularProducts,
          totalCount,
          dynamicFilters,
        };
        return res.status(200).send({ data: data });
      });
    });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

// Helper to safely parse integer query params
const parseIntQuery = (value, defaultValue = null) => {
  const parsed = parseInt(value);
  return isNaN(parsed) ? defaultValue : parsed;
};

const searchProducts = async (req, res) => {
  try {
    const { search } = req.query;
    if (!search) return res.status(400).send({ error: "search is required" });

    const query = getQuery(req.query);

    const aggregate = [
      {
        $search: {
          index: "products",
          text: {
            query: search,
            path: { wildcard: "*" },
          },
        },
      },
      { $match: { ...query } },
      { $addFields: { score: { $meta: "searchScore" } } },
      { $sort: { score: -1 } },
    ];

    const products = await ProductModel.aggregate(aggregate).exec();
    const dynamicFilters = getDynamicFilters(products);

    return res.status(200).send({ data: { products, dynamicFilters } });
  } catch (err) {
    console.error("searchProducts error:", err);
    return res.status(500).send({ error: err.message });
  }
};

const searchLiveProducts = async (req, res) => {
  try {
    const { search } = req.query;
    const limit = parseIntQuery(req.query.limit);
    const pageNumber = parseIntQuery(req.query.pageNumber);

    if (!limit) return res.status(400).send({ error: "limit is required" });
    if (!pageNumber)
      return res.status(400).send({ error: "pageNumber is required" });
    if (!search) return res.status(400).send({ error: "search is required" });

    const query = getQuery(req.query);
    query.status = "live";

    const should = [
      { text: { query: search, path: { wildcard: "*" } } },
      ...searchQueryAllowedPaths.map((p) => ({
        autocomplete: { query: search, path: p.value },
      })),
    ];

    const aggregate = [
      {
        $search: {
          index: "products",
          compound: { should, minimumShouldMatch: 1 },
        },
      },
      { $match: { ...query } },
      { $addFields: { score: { $meta: "searchScore" } } },
      { $sort: { score: -1 } },
      {
        $facet: {
          products: [{ $skip: limit * (pageNumber - 1) }, { $limit: limit }],
          allProducts: [{ $count: "count" }],
        },
      },
    ];

    const productsData = await ProductModel.aggregate(aggregate).exec();
    const authUser = await getAuthUser(req);
    const currency = req.query.currency || authUser?.prefferedCurrency || "NGN";

    const products = await addPreferredAmountAndCurrency(
      productsData[0].products,
      currency
    );
    const totalCount = productsData[0].allProducts[0]?.count || 0;
    const dynamicFilters = getDynamicFilters(productsData[0].products);

    return res
      .status(200)
      .send({ data: { products, totalCount, dynamicFilters } });
  } catch (err) {
    console.error("searchLiveProducts error:", err);
    return res.status(500).send({ error: err.message });
  }
};

const searchSimilarProducts = async (req, res) => {
  try {
    const { productId } = req.query;
    const limit = parseIntQuery(req.query.limit);

    if (!limit) return res.status(400).send({ error: "limit is required" });
    if (!productId)
      return res.status(400).send({ error: "productId is required" });

    const product = await ProductModel.findOne({ productId }).lean();
    if (!product) return res.status(400).send({ error: "product not found" });

    const searchTerms = [
      ...(product.categories.style || []),
      ...(product.categories.design || []),
      ...(product.categories.occasion || []),
    ].join(" ");

    const queryParam = {
      status: "live",
      productType: product.productType,
      "categories.main": { $in: product.categories.main },
      "categories.gender": { $in: product.categories.gender },
      "categories.age.ageGroup": product.categories.age.ageGroup,
    };

    const should = [
      { text: { query: searchTerms, path: { wildcard: "*" } } },
      { autocomplete: { query: searchTerms, path: "title" } },
      { autocomplete: { query: searchTerms, path: "categories.design" } },
      { autocomplete: { query: searchTerms, path: "categories.style" } },
      { autocomplete: { query: searchTerms, path: "categories.occasion" } },
    ];

    const aggregate = [
      {
        $search: {
          index: "products",
          compound: { should, minimumShouldMatch: 1 },
        },
      },
      { $match: { ...queryParam, productId: { $ne: productId } } },
      { $addFields: { score: { $meta: "searchScore" } } },
      { $sort: { score: -1 } },
      { $limit: limit },
    ];

    const products = await ProductModel.aggregate(aggregate).exec();
    const authUser = await getAuthUser(req);
    const currency = req.query.currency || authUser?.prefferedCurrency || "NGN";

    const productsData = await addPreferredAmountAndCurrency(
      products,
      currency
    );

    return res.status(200).send({ data: productsData });
  } catch (err) {
    console.error("searchSimilarProducts error:", err);
    return res.status(500).send({ error: err.message });
  }
};

const getQueryProductsDynamicFilters = async (req, res) => {
  try {
    const query = getQuery(req.query);
    query.status = "live";

    const productsData = await ProductModel.find({ ...query }).lean();

    const dynamicFilters = getDynamicFilters(productsData);

    return res.status(200).send({ data: dynamicFilters });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

const getShopDraftProducts = async (req, res) => {
  try {
    const { shopId } = req.query;
    if (!shopId) {
      return res.status(400).send({ error: "shopId is required" });
    }
    const draftProducts = await ProductModel.find({ shopId, status: "draft" })
      .populate("shop")
      .populate("postedBy")
      .exec();

    return res.status(200).send({
      data: draftProducts,
      message: "Draft products fetched successfully",
    });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

const getBuyAgainList = async (req, res) => {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return res.status(400).send({ error: "user not found" });
    }
    const userId = authUser._id;
    const buyAgainProducts = await ProductOrderModel.find({
      user: userId,
      status: "delivered",
    })
      .populate("product")
      .sort({ createdAt: -1 })
      .lean();
    const products = buyAgainProducts
      .map((p) => p.product)
      .filter((p) => p.status === "live");
    return res.status(200).send({
      data: products,
      message: "Buy again list fetched successfully",
    });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const searchSimilarProductsByProductId = async (productId) => {
  const product = await ProductModel.findOne({ productId }).exec();
  if (!product) {
    return res.status(400).send({ error: "product not found" });
  }

  const styles = product.categories.style;
  const design = product.categories.design;
  const occasion = product.categories.occasion;
  const search = [...styles, ...design, ...occasion].join(" ");
  const productType = product.productType;
  const main = product.categories.main;
  const gender = product.categories.gender;
  const queryParam = {
    status: "live",
    productType,
    "categories.main": { $in: main },
    "categories.gender": { $in: gender },
  };

  const should = [
    {
      text: {
        query: search,
        path: {
          wildcard: "*",
        },
      },
    },
    {
      autocomplete: {
        query: search,
        path: "title",
      },
    },
    {
      autocomplete: {
        query: search,
        path: "categories.design",
      },
    },
    {
      autocomplete: {
        query: search,
        path: "categories.style",
      },
    },
    {
      autocomplete: {
        query: search,
        path: "categories.occasion",
      },
    },
  ];
  const aggregate = [
    {
      $search: {
        index: "products",
        compound: {
          should,
          minimumShouldMatch: 1,
        },
      },
    },
    {
      $match: { ...queryParam, productId: { $ne: productId } },
    },
    {
      $limit: 20,
    },
  ];
  const products = await ProductModel.aggregate(aggregate).exec();
  return products;
};
const getAuthUserRecommendedProducts = async (req, res) => {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return res.status(400).send({ error: "user not found" });
    }
    const products = [];
    const recommendedProductList = [];
    const user_id = authUser._id;
    const userOrders = await ProductOrderModel.find({
      user: user_id,
      status: { $ne: "cancelled" },
    })
      .populate("product")
      .sort({ createdAt: -1 })
      .lean();

    const productIds = userOrders.map((o) => o.product._id.toString());

    const recommendedProducts = await ProductOrderModel.aggregate([
      {
        $match: {
          product: { $in: productIds },
          user: { $ne: user_id },
        },
      },
      {
        $group: {
          _id: "$product",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const recommendedProductIds = recommendedProducts.map((r) => r._id);

    const recommendedProductsData = await ProductModel.find({
      _id: { $in: recommendedProductIds },
      status: "live",
    }).lean();
    recommendedProductList.push(...recommendedProductsData);

    if (recommendedProductList.length < 20) {
      // if no recommended products, similar products to their orders
      const lastOrder = userOrders[0];
      const lastProduct = lastOrder?.product;
      const lastProductId = lastProduct?.productId;
      if (lastProductId) {
        const similarLastOrder = await searchSimilarProductsByProductId(
          lastProductId
        );

        recommendedProductList.push(...similarLastOrder);
      }
    }

    if (recommendedProductList.length < 20) {
      // check recently viewed products
      const recentViews = await RecentViewsModel.findOne({ user: user_id })
        .populate("products")
        .sort({ createdAt: -1 })
        .lean();

      const recentProducts = recentViews?.products?.filter(
        (p) => p.status === "live" && !productIds.includes(p._id.toString())
      );

      if (recentProducts) {
        recommendedProductList.push(...recentProducts);
      }
    }

    const currency = req.query.currency || authUser?.prefferedCurrency || "NGN";

    const filteredProducts = recommendedProductList.filter(
      (p) => !productIds.includes(p._id.toString())
    );
    // ensure unique products
    const uniqueProducts = Array.from(
      new Set(filteredProducts.map((p) => p._id.toString()))
    ).map((id) => {
      return filteredProducts.find((p) => p._id.toString() === id);
    });
    const filterLiveProducts = uniqueProducts.filter(
      (p) => p.status === "live"
    );
    const sortedProducts = filterLiveProducts.sort((a, b) => {
      const aDate = new Date(a.createdAt);
      const bDate = new Date(b.createdAt);
      return bDate - aDate;
    });
    const limitedProducts = sortedProducts.slice(0, 20);
    products.push(...limitedProducts);
    if (products.length < 20) {
      const addedProductIds = products.map((p) => p._id.toString());
      const remainingLimit = 20 - products.length;
      const moreProducts = await ProductModel.find({
        status: "live",
        productId: { $nin: addedProductIds },
      })
        .sort({ createdAt: -1 })
        .limit(remainingLimit)
        .lean();

      products.push(...moreProducts);
    }
    if (products?.length === 0) {
      return res.status(200).send({
        data: [],
        message: "No recommended products found",
      });
    }
    const productsData = await addPreferredAmountAndCurrency(
      products,
      currency
    );

    return res.status(200).send({
      data: productsData,
      message: "Recommended products fetched successfully",
    });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

const getProductOptions = async (req, res) => {
  try {
    const bodyMeasurementEnums = await getBodyMeasurementEnumsFromGuide();

    const nonClothMainEnums = ["FootWear", "Accessories"];
    const readyMadeClothesParams = {
      mainEnums: mainEnums.filter((m) => !nonClothMainEnums.includes(m)).sort(),
      genderEnums: genderEnums.sort(),
      ageGroupEnums: ageGroupEnums.sort(),
      ageRangeEnums: ageRangeEnums.sort(),
      statusEnums: statusEnums.sort(),
      clothStyleEnums: clothStyleEnums.sort(),
      sleeveLengthEnums: sleeveLengthEnums.sort(),
      designEnums: designEnums.sort(),
      fasteningEnums: fasteningEnums.sort(),
      occasionEnums: occasionEnums.sort(),
      fitEnums: fitEnums.sort(),
      brandEnums: brandEnums.sort(),
      clothSizeEnums: clothSizeEnums.sort(),
      colorEnums: colorEnums.sort((a, b) => a.name.localeCompare(b.name)),
      sizeStandardEnums: sizeStandardEnums.sort(),
    };
    const bespokeClothesParams = {
      mainEnums: mainEnums.filter((m) => !nonClothMainEnums.includes(m)).sort(),
      genderEnums: genderEnums.sort(),
      ageGroupEnums: ageGroupEnums.sort(),
      ageRangeEnums: ageRangeEnums.sort(),
      statusEnums: statusEnums.sort(),
      clothStyleEnums: clothStyleEnums.sort(),
      sleeveLengthEnums: sleeveLengthEnums.sort(),
      designEnums: designEnums.sort(),
      fasteningEnums: fasteningEnums.sort(),
      occasionEnums: occasionEnums.sort(),
      fitEnums: fitEnums.sort(),
      brandEnums: brandEnums.sort(),
      colorEnums: colorEnums.sort((a, b) => a.name.localeCompare(b.name)),
      bodyMeasurementEnums: bodyMeasurementEnums?.cloth,
    };
    const readyMadeShoeParams = {
      genderEnums: genderEnums.sort(),
      ageGroupEnums: ageGroupEnums.sort(),
      ageRangeEnums: ageRangeEnums.sort(),
      statusEnums: statusEnums.sort(),
      shoeStyleEnums: shoeStyleEnums.sort(),
      shoeTypeEnums: shoeTypeEnums.sort(),
      shoeSizeEnums: shoeSizeEnums.sort(),
      designEnums: designEnums.sort(),
      fasteningEnums: fasteningEnums.sort(),
      occasionEnums: occasionEnums.sort(),
      brandEnums: brandEnums.sort(),
      colorEnums: colorEnums.sort((a, b) => a.name.localeCompare(b.name)),
      heelHeightEnums: heelHightEnums.sort(),
      heelTypeEnums: heelTypeEnums.sort(),
      sizeStandardEnums: sizeStandardEnums.sort(),
    };
    const bespokeShoeParams = {
      genderEnums: genderEnums.sort(),
      ageGroupEnums: ageGroupEnums.sort(),
      ageRangeEnums: ageRangeEnums.sort(),
      statusEnums: statusEnums.sort(),
      shoeStyleEnums: shoeStyleEnums.sort(),
      shoeTypeEnums: shoeTypeEnums.sort(),
      designEnums: designEnums.sort(),
      fasteningEnums: fasteningEnums.sort(),
      occasionEnums: occasionEnums.sort(),
      brandEnums: brandEnums.sort(),
      colorEnums: colorEnums.sort((a, b) => a.name.localeCompare(b.name)),
      heelHeightEnums: heelHightEnums.sort(),
      heelTypeEnums: heelTypeEnums.sort(),
      bodyMeasurementEnums: bodyMeasurementEnums?.shoe,
    };
    const accessoriesParams = {
      genderEnums: genderEnums.sort(),
      ageGroupEnums: ageGroupEnums.sort(),
      ageRangeEnums: ageRangeEnums.sort(),
      statusEnums: statusEnums.sort(),
      accessoryTypeEnums: accessoryTypeEnums.sort(),
      accessoryStyleEnums: accessoryStyleEnums.sort(),
      accessorySizeEnums: accessorySizeEnums.sort(),
      designEnums: designEnums.sort(),
      fasteningEnums: fasteningEnums.sort(),
      occasionEnums: occasionEnums.sort(),
      brandEnums: brandEnums.sort(),
      colorEnums: colorEnums.sort((a, b) => a.name.localeCompare(b.name)),
    };
    res.status(200).send({
      data: {
        readyMadeClothes: readyMadeClothesParams,
        readyMadeShoes: readyMadeShoeParams,
        accessories: accessoriesParams,
        bespokeClothes: bespokeClothesParams,
        bespokeShoes: bespokeShoeParams,
        productTypeEnums: productTypeEnums,
      },
    });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const addProductVariation = async (req, res) => {
  try {
    const { productId, variation, currentStep } = req.body;
    if (!productId) {
      return res.status(400).send({ error: "productId is required" });
    }
    if (!variation) {
      return res.status(400).send({ error: "variation is required" });
    }
    const product = await ProductModel.findOne({ productId }).exec();

    if (!product) {
      return res.status(400).send({ error: "product not found" });
    }
    if (currentStep) {
      product.currentStep = currentStep;
    }
    const user = await getAuthUser(req);
    if (user.shopId !== product.shopId && !user?.isAdmin && !user?.superAdmin) {
      return res
        .status(400)
        .send({ error: "You are not authorized to edit this product" });
    }
    const productType = product.productType;
    let updatedVariation;

    if (productType === "readyMadeCloth") {
      updatedVariation = await addVariationToReadyMadeClothes(
        product,
        variation,
        user
      );
    }
    if (productType === "readyMadeShoe") {
      updatedVariation = await addVariationToReadyMadeShoes(
        product,
        variation,
        user
      );
    }
    if (productType === "accessory") {
      updatedVariation = await addVariationToAccesories(
        product,
        variation,
        user
      );
    }
    if (productType === "bespokeCloth") {
      updatedVariation = await addVariationToBespokeCloth(
        product,
        variation,
        user
      );
    }
    if (productType === "bespokeShoe") {
      updatedVariation = await addVariationToBespokeShoe(
        product,
        variation,
        user
      );
    }
    if (!updatedVariation) {
      return res.status(400).send({ error: "product not found" });
    }
    if (!updatedVariation) {
      return res.status(400).send({ error: "product not found" });
    }
    if (updatedVariation.error) {
      return res.status(400).send({ error: updatedVariation.error });
    }
    const timeLine = {
      date: new Date(),
      description: `variation with sku ${updatedVariation.sku} added`,
      actionBy: user._id,
    };
    await ProductModel.findOneAndUpdate(
      { productId },
      { $push: { timeLine } },
      { new: true }
    ).exec();

    return res.status(200).send({
      data: updatedVariation,
      message: "variation added successfully",
    });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const editProductVariation = async (req, res) => {
  try {
    const { productId, variation } = req.body;
    if (!productId) {
      return res.status(400).send({ error: "productId is required" });
    }
    if (!variation) {
      return res.status(400).send({ error: "variation is required" });
    }
    const product = await ProductModel.findOne({ productId }).exec();
    if (!product) {
      return res.status(400).send({ error: "product not found" });
    }
    const user = await getAuthUser(req);
    if (user.shopId !== product.shopId && !user?.isAdmin && !user?.superAdmin) {
      return res
        .status(400)
        .send({ error: "You are not authorized to edit this product" });
    }
    if (!variation?.sku) {
      return res.status(400).send({ error: "sku is required" });
    }
    const originalVariation = product.variations.find(
      (v) => v.sku === variation.sku
    );
    if (!originalVariation) {
      return res.status(400).send({ error: "variation not found" });
    }
    const productType = product.productType;
    if (productType === "readyMadeCloth" || productType === "readyMadeShoe") {
      if (originalVariation?.colorValue !== variation.colorValue) {
        return res.status(400).send({
          error:
            "color of variation cannot be edited. delete and create a new variation with correct color instead",
        });
      }
      if (originalVariation?.size !== variation.size) {
        return res.status(400).send({
          error:
            "size of variation cannot be edited. delete and create a new variation with correct size instead",
        });
      }
    }

    let updatedProduct;
    if (productType === "readyMadeCloth") {
      updatedProduct = await addVariationToReadyMadeClothes(product, variation);
    }
    if (productType === "readyMadeShoe") {
      updatedProduct = await addVariationToReadyMadeShoes(product, variation);
    }
    if (productType === "accessory") {
      updatedProduct = await addVariationToAccesories(product, variation);
    }
    if (productType === "bespokeCloth") {
      updatedProduct = await addVariationToBespokeCloth(product, variation);
    }
    if (productType === "bespokeShoe") {
      updatedProduct = await addVariationToBespokeShoe(product, variation);
    }
    if (!updatedProduct) {
      return res.status(400).send({ error: "product not found" });
    }
    if (updatedProduct.error) {
      return res.status(400).send({ error: updatedProduct.error });
    }
    const descriptionBase = `varation with sku ${variation.sku} updated`;
    let description = descriptionBase;
    if (originalVariation?.price !== variation.price) {
      description = `${descriptionBase}. price updated from ${originalVariation.price} to ${variation.price}`;
    }
    if (originalVariation?.quantity !== variation.quantity) {
      description = `${descriptionBase}. quantity updated from ${originalVariation.quantity} to ${variation.quantity}`;
    }
    if (
      originalVariation?.price !== variation.price &&
      originalVariation?.quantity !== variation.quantity
    ) {
      description = `${descriptionBase}. price updated from ${originalVariation.price} to ${variation.price} and quantity updated from ${originalVariation.quantity} to ${variation.quantity}`;
    }
    const newTimeLine = {
      date: new Date(),
      description,
      actionBy: user._id,
    };

    await ProductModel.findOneAndUpdate(
      { productId },
      { $push: { timeLine: newTimeLine } },
      { new: true }
    ).exec();

    return res
      .status(200)
      .send({ data: updatedProduct, message: "product updated successfully" });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const deleteProductVariation = async (req, res) => {
  try {
    const { productId, sku } = req.body;
    if (!productId) {
      return res.status(400).send({ error: "productId is required" });
    }
    if (!sku) {
      return res.status(400).send({ error: "sku is required" });
    }
    const product = await ProductModel.findOne({ productId }).exec();
    if (!product) {
      return res.status(400).send({ error: "product not found" });
    }
    const user = await getAuthUser(req);
    if (user.shopId !== product.shopId && !user?.isAdmin && !user?.superAdmin) {
      return res
        .status(400)
        .send({ error: "You are not authorized to edit this product" });
    }
    const variations = product.variations;

    const variationExist = variations.find((v) => v.sku === sku);
    if (!variationExist) {
      return res.status(400).send({ error: "variation not found" });
    }
    updatedVariations = variations.filter((v) => v.sku !== sku);
    const timeLines = product.timeLine;
    const timeLine = {
      date: new Date(),
      description: `variation with sku ${sku} deleted`,
      actionBy: user._id,
    };
    timeLines.push(timeLine);

    const updatedProduct = await ProductModel.findOneAndUpdate(
      { productId },
      { variations: updatedVariations, timeLine: timeLines },
      { new: true }
    ).exec();

    if (!updatedProduct) {
      return res.status(400).send({ error: "product not found" });
    }
    return res
      .status(200)
      .send({ data: updatedProduct, message: "product updated successfully" });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const updateAutoPriceAdjustment = async (req, res) => {
  try {
    const { productId, isAdjustable, adjustmentPercentage, currentStep } =
      req.body;

    if (!productId) {
      return res.status(400).send({ error: "productId is required" });
    }
    if (isAdjustable === undefined) {
      return res
        .status(400)
        .send({ error: "isAdjustable is required and its boolean" });
    }
    if (isAdjustable && !adjustmentPercentage && adjustmentPercentage === 0) {
      return res.status(400).send({
        error: "adjustmentPercentage is required and must be more than 0",
      });
    }

    if (
      isAdjustable &&
      (adjustmentPercentage < 0 || adjustmentPercentage > 100)
    ) {
      return res
        .status(400)
        .send({ error: "adjustmentPercentage must be between 0 and 100" });
    }

    const product = await ProductModel.findOne({ productId }).exec();
    if (!product) {
      return res.status(400).send({ error: "product not found" });
    }
    const user = await getAuthUser(req);
    if (user.shopId !== product.shopId && !user?.isAdmin && !user?.superAdmin) {
      return res
        .status(400)
        .send({ error: "You are not authorized to edit this product" });
    }
    const autoPriceAdjustment = {
      isAdjustable,
      adjustmentPercentage: isAdjustable ? adjustmentPercentage : 0,
    };

    const updatedProduct = await ProductModel.findOneAndUpdate(
      { productId },
      {
        autoPriceAdjustment,
        currentStep: currentStep ? currentStep : product.currentStep,
      },

      { new: true }
    ).exec();
    if (!updatedProduct) {
      return res.status(400).send({ error: "product not found" });
    }
    return res.status(200).send({
      data: updatedProduct,
      message: "product updated successfully",
    });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

const getAllLiveBrandsAndProductCount = async (req, res) => {
  try {
    const query = getQuery(req.query);
    query.status = "live";
    const brands = await ProductModel.aggregate([
      {
        $match: { ...query },
      },
      {
        $group: {
          _id: "$categories.brand",
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          brand: "$_id",
          count: 1,
          _id: 0,
        },
      },

      {
        $sort: { brand: 1 },
      },
    ]).exec();
    return res.status(200).send({ data: brands });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
module.exports = {
  editProduct,
  deleteProducts,
  restoreProducts,
  createProduct,
  getProduct,
  getShopProducts,
  getCategoryProducts,
  getProducts,
  getAuthShopProducts,
  getLiveProducts,
  getLiveProductsLeastPrice,
  getAllLiveBrandsAndProductCount,
  getPromoWithLiveProducts,
  getNewestArrivals,
  getBespoke,
  getMostPopular,
  searchProducts,
  searchLiveProducts,
  getShopDraftProducts,
  setProductStatus,
  getProductOptions,
  getQueryProductsDynamicFilters,
  getProductById,
  addProductColorAndImages,
  deleteProductColor,
  deleteProductImage,
  setProductImageAsDefault,
  addImagesToProductColor,
  addProductVariation,
  editProductVariation,
  updateAutoPriceAdjustment,
  deleteProductVariation,
  submitProduct,
  searchSimilarProducts,
  getBuyAgainList,
  getAuthUserRecommendedProducts,
};
