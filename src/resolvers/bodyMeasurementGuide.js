const BodyMeasurementGuideModel = require("../models/bodyMeasurementGuide");
const { storageRef } = require("../config/firebase"); // reference to our db
const root = require("../../root");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const sharp = require("sharp");
const { deleteLocalFile, deleLocalImages } = require("../helpers/utils");
const readyMadeSizeGuide = require("../helpers/readyMadeSizeGuide");

const buildBodyMeasurementGuideImageUrl = (name) => {
  if (!name) {
    return "";
  }

  return `https://storage.googleapis.com/${storageRef.name}/${encodeURIComponent(
    `/bodyMeasurementGuide/${name}`,
  )}`;
};

const normalizeImageUrl = (imageUrl = {}) => {
  if (!imageUrl?.name) {
    return imageUrl;
  }

  return {
    ...imageUrl,
    link: buildBodyMeasurementGuideImageUrl(imageUrl.name),
  };
};

const normalizeBodyMeasurementGuide = (guide = {}) => {
  if (!guide?.fields) {
    return guide;
  }

  return {
    ...guide,
    fields: guide.fields.map((field) => ({
      ...field,
      imageUrl: normalizeImageUrl(field.imageUrl),
    })),
  };
};

//saving image to firebase storage
const addImage = async (req, filename) => {
  let url = {};
  if (filename) {
    const source = path.join(root + "/uploads/" + filename);

    await sharp(source)
      // .resize(1024, 1024)
      // .jpeg({ quality: 90 })
      .toFile(path.resolve(req.file.destination, "resized", filename));
    const storage = await storageRef.upload(
      path.resolve(req.file.destination, "resized", filename),
      {
        public: true,
        destination: `/bodyMeasurementGuide/${filename}`,
        metadata: {
          firebaseStorageDownloadTokens: uuidv4(),
        },
      },
    );
    url = {
      link: buildBodyMeasurementGuideImageUrl(filename),
      name: filename,
    };
    const deleteSourceFile = await deleteLocalFile(source);
    const deleteResizedFile = await deleteLocalFile(
      path.resolve(req.file.destination, "resized", filename),
    );
    await Promise.all([deleteSourceFile, deleteResizedFile]);
    return url;
  }
  return url;
};

const deleteImageFromFirebase = async (name) => {
  if (name) {
    return storageRef
      .file("/bodyMeasurementGuide/" + name)
      .delete()
      .then(() => {
        return true;
      })
      .catch(() => {
        return false;
      });
  }

  return false;
};

const checkImageInUse = async (name, excludedFieldId = null) => {
  const bodyMeasurementGuides = await BodyMeasurementGuideModel.find({
    "fields.imageUrl.name": name,
  })
    .select("fields._id fields.imageUrl.name")
    .lean();

  return bodyMeasurementGuides.some((guide) =>
    guide.fields.some(
      (field) =>
        field?.imageUrl?.name === name &&
        (!excludedFieldId ||
          field._id.toString() !== excludedFieldId.toString()),
    ),
  );
};

const getBodyMeasurementGuide = async (req, res) => {
  try {
    const { gender } = req.query;
    if (!gender) {
      return res.status(400).send({
        error: "gender field is required",
      });
    }
    const bodyMeasurementGuide = await BodyMeasurementGuideModel.find({
      gender: gender.toLowerCase(),
    }).lean();

    const normalizedGuide = bodyMeasurementGuide.map((guide) =>
      normalizeBodyMeasurementGuide(guide),
    );

    return res.status(200).send({ data: normalizedGuide });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const getFieldImagesGallery = async (req, res) => {
  try {
    const images = await BodyMeasurementGuideModel.find()
      .select("fields")
      .lean();
    const gallery = images
      .map((item) => {
        return item.fields.map((field) => {
          if (field.imageUrl.name) {
            return {
              imageUrl: buildBodyMeasurementGuideImageUrl(field.imageUrl.name),
              title: field.field,
            };
          }
        });
      })
      .flat()
      .filter((item) => item !== undefined && item !== null && item !== "");

    // ensure that imageUrl is not null or empty

    return res.status(200).send({ data: gallery });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

const updateFieldImage = async (req, res) => {
  try {
    const { fieldId, existingLink, gender } = req.body;

    if (!req.file && !existingLink) {
      return res.status(400).send({ error: "no file uploaded" });
    }

    if (req.file && existingLink) {
      await deleLocalImages([req.file]);
      return res.status(400).send({ error: "Only one image is required" });
    }
    if (!gender) {
      if (req.file) {
        await deleLocalImages([req.file]);
      }
      return res.status(400).send({ error: "gender is required" });
    }

    const bodyMeasurementGuide = await BodyMeasurementGuideModel.findOne({
      "fields._id": fieldId,
      gender,
    });

    if (!bodyMeasurementGuide) {
      return res.status(404).send({ error: "Field not found" });
    }
    if (existingLink) {
      const exist = await BodyMeasurementGuideModel.findOne({
        "fields.imageUrl.link": existingLink,
      });

      if (!exist) {
        return res.status(404).send({ error: "Image not found" });
      }
      const imageUrlName = exist.fields.find(
        (field) => field.imageUrl.link === existingLink,
      ).imageUrl.name;

      const fieldIndex = bodyMeasurementGuide.fields.findIndex(
        (field) => field._id.toString() === fieldId,
      );
      if (bodyMeasurementGuide.fields[fieldIndex].imageUrl.name) {
        const isImageInUse = await checkImageInUse(
          bodyMeasurementGuide.fields[fieldIndex].imageUrl.name,
          fieldId,
        );
        if (!isImageInUse) {
          await deleteImageFromFirebase(
            bodyMeasurementGuide.fields[fieldIndex].imageUrl.name,
          );
        }
      }
      bodyMeasurementGuide.fields[fieldIndex].imageUrl = {
        link: buildBodyMeasurementGuideImageUrl(imageUrlName),
        name: imageUrlName,
      };

      await bodyMeasurementGuide.save();
      return res.status(200).send({
        data: normalizeBodyMeasurementGuide(bodyMeasurementGuide.toObject()),
      });
    }

    const filename = req.file.filename;

    if (bodyMeasurementGuide) {
      const imageUrl = await addImage(req, filename);
      const fieldIndex = bodyMeasurementGuide.fields.findIndex(
        (field) => field._id.toString() === fieldId,
      );
      if (bodyMeasurementGuide.fields[fieldIndex].imageUrl.name) {
        const isImageInUse = await checkImageInUse(
          bodyMeasurementGuide.fields[fieldIndex].imageUrl.name,
          fieldId,
        );
        if (!isImageInUse) {
          await deleteImageFromFirebase(
            bodyMeasurementGuide.fields[fieldIndex].imageUrl.name,
          );
        }
      }
      bodyMeasurementGuide.fields[fieldIndex].imageUrl = imageUrl;
      await bodyMeasurementGuide.save();
      return res.status(200).send({
        data: normalizeBodyMeasurementGuide(bodyMeasurementGuide.toObject()),
      });
    }
    if (!bodyMeasurementGuide) {
      return res.status(404).send({ error: "Field not found" });
    }
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const editBodyMeasurementField = async (req, res) => {
  try {
    const { fieldId, field, description, gender } = req.body;
    if (!fieldId) {
      return res.status(400).send({ error: "required fieldId" });
    }
    if (!field) {
      return res.status(400).send({ error: "required field" });
    }
    if (!description) {
      return res.status(400).send({ error: "required description" });
    }
    if (!gender) {
      return res.status(400).send({ error: "required gender" });
    }

    const bodyMeasurementGuide = await BodyMeasurementGuideModel.findOne({
      "fields._id": fieldId,
      gender,
    });
    if (!bodyMeasurementGuide) {
      return res.status(404).send({ error: "Field not found" });
    }
    const fieldIndex = bodyMeasurementGuide.fields.findIndex(
      (field) => field._id.toString() === fieldId,
    );
    bodyMeasurementGuide.fields[fieldIndex].field = field;
    bodyMeasurementGuide.fields[fieldIndex].description = description;

    await bodyMeasurementGuide.save();
    return res.status(200).send({ data: bodyMeasurementGuide });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const deleteBodyMeasurementField = async (req, res) => {
  try {
    const { fieldId, gender } = req.body;
    if (!fieldId) {
      return res.status(400).send({ error: "required fieldId" });
    }
    if (!gender) {
      return res.status(400).send({ error: "required gender" });
    }
    const bodyMeasurementGuide = await BodyMeasurementGuideModel.findOne({
      "fields._id": fieldId,
      gender,
    });
    if (!bodyMeasurementGuide) {
      return res.status(404).send({ error: "Field not found" });
    }
    const fieldIndex = bodyMeasurementGuide.fields.findIndex(
      (field) => field._id.toString() === fieldId,
    );
    if (bodyMeasurementGuide.fields[fieldIndex].imageUrl.name) {
      const isImageInUse = await checkImageInUse(
        bodyMeasurementGuide.fields[fieldIndex].imageUrl.name,
        fieldId,
      );
      if (!isImageInUse) {
        await deleteImageFromFirebase(
          bodyMeasurementGuide.fields[fieldIndex].imageUrl.name,
        );
      }
    }
    bodyMeasurementGuide.fields.splice(fieldIndex, 1);
    await bodyMeasurementGuide.save();
    return res.status(200).send({ data: bodyMeasurementGuide });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

const deleteBodyMeasurementFieldImage = async (req, res) => {
  try {
    const { fieldId, gender } = req.body;
    if (!gender) {
      return res.status(400).send({ error: "required gender" });
    }
    const bodyMeasurementGuide = await BodyMeasurementGuideModel.findOne({
      "fields._id": fieldId,
      gender,
    });
    if (!bodyMeasurementGuide) {
      return res.status(404).send({ error: "Field not found" });
    }
    const fieldIndex = bodyMeasurementGuide.fields.findIndex(
      (field) => field._id.toString() === fieldId,
    );
    if (bodyMeasurementGuide.fields[fieldIndex].imageUrl.name) {
      const isImageInUse = await checkImageInUse(
        bodyMeasurementGuide.fields[fieldIndex].imageUrl.name,
        fieldId,
      );
      if (!isImageInUse) {
        await deleteImageFromFirebase(
          bodyMeasurementGuide.fields[fieldIndex].imageUrl.name,
        );
      }
    }
    bodyMeasurementGuide.fields[fieldIndex].imageUrl = { link: "", name: "" };
    await bodyMeasurementGuide.save();
    return res.status(200).send({ data: bodyMeasurementGuide });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const deleteBodyMeasurementGuide = async (req, res) => {
  try {
    const { bodyMeasurementGuide_id } = req.body;
    if (!bodyMeasurementGuide_id) {
      return res
        .status(400)
        .send({ error: "required bodyMeasurementGuide_id" });
    }
    const bodyMeasurementGuide =
      await BodyMeasurementGuideModel.findByIdAndDelete(
        bodyMeasurementGuide_id,
      );
    if (!bodyMeasurementGuide) {
      return res
        .status(404)
        .send({ error: "Body Measurement Guide not found" });
    }
    return res.status(200).send({
      data: bodyMeasurementGuide,
      message: "Body Measurement Guide deleted successfully",
    });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const updateBodyMeasurementGuideName = async (req, res) => {
  try {
    const { bodyMeasurementGuide_id, name } = req.body;
    if (!bodyMeasurementGuide_id) {
      return res
        .status(400)
        .send({ error: "required bodyMeasurementGuide_id" });
    }
    if (!name) {
      return res.status(400).send({ error: "required name" });
    }
    const bodyMeasurementGuide = await BodyMeasurementGuideModel.findById(
      bodyMeasurementGuide_id,
    );
    if (!bodyMeasurementGuide) {
      return res
        .status(404)
        .send({ error: "Body Measurement Guide not found" });
    }
    bodyMeasurementGuide.name = name;
    await bodyMeasurementGuide.save();
    return res.status(200).send({ data: bodyMeasurementGuide });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const addBodyMeasurementGuideField = async (req, res) => {
  try {
    const { bodyMeasurementGuide_id, field, description } = req.body;
    if (!bodyMeasurementGuide_id) {
      return res
        .status(400)
        .send({ error: "required bodyMeasurementGuide_id" });
    }
    if (!field) {
      return res.status(400).send({ error: "required field" });
    }
    if (!description) {
      return res.status(400).send({ error: "required description" });
    }
    const bodyMeasurementGuide = await BodyMeasurementGuideModel.findById(
      bodyMeasurementGuide_id,
    );
    if (!bodyMeasurementGuide) {
      return res
        .status(404)
        .send({ error: "Body Measurement Guide not found" });
    }
    // check if field already exists

    const fieldExists = bodyMeasurementGuide.fields.find(
      (f) => f.field.trim().toLowerCase() === field.trim().toLowerCase(),
    );
    if (fieldExists) {
      return res.status(400).send({ error: "Field already exists" });
    }
    const newField = {
      field,
      imageUrl: { link: "", name: "" },
      description,
    };
    bodyMeasurementGuide.fields.push(newField);
    await bodyMeasurementGuide.save();
    return res.status(200).send({ data: bodyMeasurementGuide });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

const addBodyMeasurementGuide = async (req, res) => {
  try {
    const { name, gender } = req.body;
    if (!name) {
      return res.status(400).send({ error: "required name" });
    }
    if (!gender) {
      return res.status(400).send({ error: "required gender" });
    }
    if (gender !== "male" && gender !== "female") {
      return res.status(400).send({ error: "gender must be male or female" });
    }
    // check if name already exists
    const nameExists = await BodyMeasurementGuideModel.findOne({
      name,
    });
    if (nameExists) {
      return res.status(400).send({ error: "Name already exists" });
    }
    const bodyMeasurementGuide = new BodyMeasurementGuideModel({
      name,
      gender,
      fields: [],
    });
    await bodyMeasurementGuide.save();
    return res.status(200).send({ data: bodyMeasurementGuide });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const getBodyMeasurementFields = async (req, res) => {
  try {
    const queryParams = Object.keys(req.query).reduce((acc, key) => {
      acc[key.toLowerCase()] = req.query[key];
      return acc;
    }, {});

    const bodyMeasurementGuide = await BodyMeasurementGuideModel.find({
      ...queryParams,
    }).lean();
    const bodyGuideFields = bodyMeasurementGuide
      .map((guide) => guide.fields)
      .flat();

    const fields = bodyGuideFields.map((field) => field.field);
    const uniqueFields = [...new Set(fields)];
    const bodyMeasurementGuideFields = uniqueFields.map((field, index) => ({
      field,
      _id: index,
    }));

    return res.status(200).send({ data: bodyMeasurementGuideFields });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

const getReadyMadeSizeGuide = async (req, res) => {
  try {
    const guide = readyMadeSizeGuide;
    if (!guide) {
      return res.status(404).send({ error: "guide not found" });
    }
    return res.status(200).send({ data: guide });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

module.exports = {
  getBodyMeasurementGuide,
  getFieldImagesGallery,
  updateFieldImage,
  editBodyMeasurementField,
  deleteBodyMeasurementField,
  deleteBodyMeasurementFieldImage,
  deleteBodyMeasurementGuide,
  updateBodyMeasurementGuideName,
  addBodyMeasurementGuideField,
  addBodyMeasurementGuide,
  getBodyMeasurementFields,
  getReadyMadeSizeGuide,
};
