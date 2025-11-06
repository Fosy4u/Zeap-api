const geoip = require("geoip-lite");
const requestIp = require("request-ip");
const UserModel = require("../models/user");
const ShopModel = require("../models/shop");
const { storageRef } = require("../config/firebase"); // reference to our db
const root = require("../../root");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const sharp = require("sharp");
const {
  deleteLocalFile,
  cryptoDecrypt,
  cryptoEncrypt,
  replaceUserVariablesinTemplate,
  replaceShopVariablesinTemplate,
  allowedLocations,
  getServerIp,
} = require("../helpers/utils");
const validator = require("email-validator");
const { firebase } = require("../config/firebase");
const { generateUniqueShopId } = require("./shop");
const {
  getAuthUser,
  getAuthUserUid,
} = require("../middleware/firebaseUserAuth");
const { sendOTP, verifyOTP } = require("../helpers/sms");
const PointModel = require("../models/points");
const { sendEmail } = require("../helpers/emailer");
const EmailTemplateModel = require("../models/emailTemplate");
const BasketModel = require("../models/basket");
const { generateUniqueBasketId } = require("./basket");
const WishModel = require("../models/wish");
const BodyMeasurementTemplateModel = require("../models/bodyMeasurementTemplate");
const OrderModel = require("../models/order");
const VoucherModel = require("../models/voucher");
const PaymentModel = require("../models/payment");
const ProductOrderModel = require("../models/productOrder");
const DeliveryAddressModel = require("../models/deliveryAddresses");

//saving image to firebase storage
const addImage = async (req, filename) => {
  let url = {};
  if (filename) {
    const source = path.join(root + "/uploads/" + filename);
    await sharp(source)
      .resize(1024, 1024)
      .jpeg({ quality: 90 })
      .toFile(path.resolve(req.file.destination, "resized", filename));
    const storage = await storageRef.upload(
      path.resolve(req.file.destination, "resized", filename),
      {
        public: true,
        destination: `/user/${filename}`,
        metadata: {
          firebaseStorageDownloadTokens: uuidv4(),
        },
      }
    );
    url = { link: storage[0].metadata.mediaLink, name: filename };
    const deleteSourceFile = await deleteLocalFile(source);
    const deleteResizedFile = await deleteLocalFile(
      path.resolve(req.file.destination, "resized", filename)
    );
    await Promise.all([deleteSourceFile, deleteResizedFile]);
    return url;
  }
  return url;
};

const deleteImageFromFirebase = async (name) => {
  if (name) {
    storageRef
      .file("/user/" + name)
      .delete()
      .then(() => {
        return true;
      })
      .catch((err) => {
        return false;
      });
  }
};

function getRandomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

const generateUniqueUserId = async () => {
  let userId;
  let found = true;

  do {
    const randomVal = getRandomInt(1000000, 9999999);
    userId = `${randomVal}`;
    const exist = await UserModel.findOne(
      {
        userId,
      },
      { lean: true }
    );

    if (exist) {
      found = true;
    } else {
      found = false;
    }
  } while (found);

  return userId.toString();
};
const addUserToFirebase = async (params) => {
  const { email, password, displayName } = params;

  try {
    const user = await firebase
      .auth()
      .createUser({ email, password, displayName });

    return user;
  } catch (error) {
    return error;
  }
};
const deleteUserFromFirebase = async (uid) => {
  try {
    const user = await firebase.auth().deleteUser(uid);
    return user;
  } catch (error) {
    return error;
  }
};

const creatGuestUser = async (req, res) => {
  try {
    const uid = await getAuthUserUid(req);
    if (!uid) {
      return res.status(400).send({ error: "User Uid  not found" });
    }
    const user = await UserModel.findOne({ uid });

    if (user) {
      return res.status(200).send({ data: user });
    }
    const userId = await generateUniqueUserId();
    const isGuest = true;
    const firstName = "Customer";
    const lastName = "Guest";
    const email = "";
    // const displayName = "Guest User";
    const imageUrl = {};
    let prefferedCurrency = "NGN";

    const clientIp = requestIp.getClientIp(req);
    let ip = clientIp;
    if (clientIp === "::1") {
      ip = await getServerIp();
    }
    const geo = geoip.lookup(ip);
    const countryCode = geo?.country || "NG";
    const location = allowedLocations.find(
      (location) => location.countryCode === countryCode
    );
    if (location) {
      prefferedCurrency = location.currency;
    }

    const newUser = new UserModel({
      email,
      firstName,
      lastName,
      imageUrl,
      userId,
      uid,
      isGuest,
      prefferedCurrency,
    });
    const savedUser = await newUser.save();

    if (!savedUser) {
      return res.status(400).send({ error: "User not created" });
    }

    return res.status(200).send({ data: savedUser });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const getRecommendedCurrency = async (req, res) => {
  try {
    const clientIp = requestIp.getClientIp(req);
    let ip = clientIp;
    if (clientIp === "::1") {
      ip = await getServerIp();
    }

    const geo = geoip.lookup(ip);

    const countryCode = geo?.country || "NG";
    let prefferedCurrency = "NGN";
    let location = allowedLocations.find(
      (location) => location.countryCode === countryCode
    );
    if (location) {
      prefferedCurrency = location.currency;
      return res.status(200).send({
        data: prefferedCurrency || "NGN",
        message: "Location found and country currency supported",
      });
    }
    const timezoneContinent = geo?.timezone.split("/")[0] || "Africa";
    const foundLocation = allowedLocations.find(
      (location) => location.timezone.split("/")[0] === timezoneContinent
    );
    if (foundLocation) {
      prefferedCurrency = foundLocation.currency;
      return res.status(200).send({
        data: prefferedCurrency || "NGN",
        message: "Location found but country currency not supported",
      });
    }

    return res.status(200).send({
      message:
        "Location found but country currency not supported as well as timezone",
      data: "NGN",
    });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};
const convertGuestUserWithEmailPasswordProvider = async (req, res) => {
  try {
    const body = req.body;
    const { email, password } = body;
    if (!email) {
      return res.status(400).send({ error: "email is required" });
    }
    if (!password) {
      return res.status(400).send({ error: "password is required" });
    }
    const uid = await getAuthUserUid(req);
    if (!uid) {
      return res.status(400).send({ error: "User Uid  not found" });
    }
    const user = await UserModel.findOne({ uid }).lean();
    if (!user) {
      return res.status(404).send({ error: "Guest User not found" });
    }
    if (!user.isGuest) {
      return res.status(400).send({ error: "User is not a guest" });
    }
    const decriptedPassword = cryptoDecrypt(password);
    const firebaseUser = await addUserToFirebase({
      email,
      password: decriptedPassword,
    });
    if (!firebaseUser.uid) {
      return res.status(400).send({ error: "Error creating user" });
    }
    const updatedUser = await UserModel.findByIdAndUpdate(
      user._id,
      { email, uid: firebaseUser.uid, ...body, isGuest: false },
      { new: true }
    );
    if (!updatedUser) {
      return res.status(500).send({ error: "Error updating user" });
    }
    // create point for user
    const point = new PointModel({
      user: updatedUser._id,
      availablePoints: 500,
      redeemedPoints: 0,
      totalPoints: 500,
    });

    const newPoint = await point.save();
    const welcomeUserEmailTemplate = await EmailTemplateModel.findOne({
      name: "welcome-user",
    }).lean();
    const formattedUserTemplateBody = replaceUserVariablesinTemplate(
      welcomeUserEmailTemplate?.body,
      updatedUser
    );

    const formattedUserTemplateSubject = replaceUserVariablesinTemplate(
      welcomeUserEmailTemplate?.subject,
      updatedUser
    );

    const param = {
      from: "admin@zeaper.com",
      to: [email],
      subject: formattedUserTemplateSubject || "Welcome",
      body: formattedUserTemplateBody || "Welcome to Zeap",
    };
    const userMail = await sendEmail(param);
    await deleteUserFromFirebase(user.uid);

    return res.status(200).send({ data: updatedUser });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

const createUser = async (req, res) => {
  const { email, password } = req.body;
  let firebaseUser = {};
  let newUser;

  try {
    if (!email) {
      return res.status(400).send({ error: "email is required" });
    }
    if (!password) {
      return res.status(400).send({ error: "password is required" });
    }
    // check if social is Json string
    if (req.body?.social) {
      try {
        JSON.parse(req.body.social);
      } catch (e) {
        return res
          .status(400)
          .send({ error: "social must be a valid JSON string" });
      }
    }

    if (email && !validator.validate(email)) {
      return res.status(400).send({ error: "email is invalid" });
    }
    if (email) {
      const alreadyUser = await UserModel.findOne({ email }).lean();

      if (alreadyUser) {
        return res.status(400).send({
          error: "An account with same email address is already existing.",
        });
      }
    }

    const decriptedPassword = cryptoDecrypt(password);

    req.body.password = decriptedPassword;
    firebaseUser = await addUserToFirebase(req.body);
    if (!firebaseUser.uid) {
      return res.status(400).send({ error: "Error creating user" });
    }

    let imageUrl = {};

    if (req.file) {
      imageUrl = await addImage(req, req.file.filename);
    }
    if (typeof req.body?.social === "string") {
      req.body.social = JSON.parse(req.body.social);
    }

    const userId = await generateUniqueUserId();

    const params = {
      ...req.body,
      imageUrl,
      email,
      userId,
      uid: firebaseUser.uid,
      emailVerified: firebaseUser.emailVerified,
    };

    const user = new UserModel({ ...params });
    newUser = await user.save();
    if (!newUser) {
      if (firebaseUser.uid) {
        await deleteUserFromFirebase(firebaseUser.uid);
      }
      return res.status(500).send({ error: "Error creating user" });
    }
    // create point for user
    const point = new PointModel({
      user: newUser._id,
      availablePoints: 500,
      redeemedPoints: 0,
      totalPoints: 500,
    });

    const newPoint = await point.save();

    const data = {};

    const welcomeUserEmailTemplate = await EmailTemplateModel.findOne({
      name: "welcome-user",
    }).lean();
    const formattedUserTemplateBody = replaceUserVariablesinTemplate(
      welcomeUserEmailTemplate?.body,
      user
    );

    const formattedUserTemplateSubject = replaceUserVariablesinTemplate(
      welcomeUserEmailTemplate?.subject,
      user
    );

    const param = {
      from: "admin@zeaper.com",
      to: [email],
      subject: formattedUserTemplateSubject || "Welcome",
      body: formattedUserTemplateBody || "Welcome to Zeap",
    };
    const userMail = await sendEmail(param);

    return res.status(200).send({
      data,
      message: "User created successfully",
    });
  } catch (error) {
    if (firebaseUser.uid) {
      const deleteFirebaseUser = await deleteUserFromFirebase(firebaseUser.uid);
      if (deleteFirebaseUser) {
        console.log("Error deleting user from firebase", firebaseUser);
      }
    }
    if (newUser?._id) {
      const deleteUser = await UserModel.findByIdAndDelete(newUser._id);
      if (!deleteUser) {
        console.log("Error deleting user", newUser._id);
      }
    }

    return res
      .status(500)
      .send({ error: error.message, message: "Error creating user" });
  }
};

const createUserWithGoogleOrApple = async (req, res) => {
  try {
    const { email, firstName, lastName } = req.body;

    if (!email) {
      return res.status(400).send({ error: "email is required" });
    }
    if (!firstName) {
      return res.status(400).send({ error: "firstName is required" });
    }
    if (!lastName) {
      return res.status(400).send({ error: "lastName is required" });
    }
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return res.status(400).send({ error: "User not found in firebase" });
    }
    const alreadyUser = await UserModel.findOne({ email }).lean();
    if (alreadyUser) {
      const deleteFirebaseUser = await deleteUserFromFirebase(uid);
      return res.status(400).send({
        error: "An account with same email address is already existing.",
      });
    }
    const uid = authUser.uid;
    const displayName = `${firstName} ${lastName}`;
    const userId = await generateUniqueUserId();
    const user = new UserModel({
      email,
      firstName,
      lastName,
      displayName,
      imageUrl,
      userId,
      uid,
    });
    const newUser = await user.save();
    if (!newUser) {
      return res.status(500).send({ error: "Error creating user" });
    }
    // create point for user
    const point = new PointModel({
      user: newUser._id,
      availablePoints: 500,
      redeemedPoints: 0,
      totalPoints: 500,
    });

    const newPoint = await point.save();
    const welcomeUserEmailTemplate = await EmailTemplateModel.findOne({
      name: "welcome-user",
    }).lean();
    const formattedUserTemplateBody = replaceUserVariablesinTemplate(
      welcomeUserEmailTemplate?.body,
      user
    );

    const formattedUserTemplateSubject = replaceUserVariablesinTemplate(
      welcomeUserEmailTemplate?.subject,
      user
    );

    const param = {
      from: "admin@zeaper.com",
      to: [email],
      subject: formattedUserTemplateSubject || "Welcome",
      body: formattedUserTemplateBody || "Welcome to Zeap",
    };
    const userMail = await sendEmail(param);
    return res
      .status(200)
      .send({ data: newUser, message: "User created successfully" });
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
};
const mergePasswordLoginGuestUser = async (req, res) => {
  try {
    const { guestUid } = req.body;
    if (!guestUid) {
      return res.status(400).send({ error: "guestUid is required" });
    }
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return res.status(400).send({
        error: "current logged in Password User not found in firebase",
      });
    }
    const guestUser = await UserModel.findOne({ uid: guestUid }).lean();
    if (!guestUser) {
      return res.status(404).send({ error: "Guest User not found" });
    }
    if (!guestUser.isGuest) {
      return res.status(400).send({ error: "User is not a guest" });
    }
    const updateGuestOrders = await OrderModel.updateMany(
      { user: guestUser._id },
      { user: authUser._id }
    );
    const updateGuestProductOrders = await ProductOrderModel.updateMany(
      { user: guestUser._id },
      { user: authUser._id }
    );
    const updateGuestPayments = await PaymentModel.updateMany(
      { user: guestUser._id },
      { user: authUser._id }
    );
    const updateGuestVouchers = await VoucherModel.updateMany(
      { user: guestUser._id },
      { user: authUser._id }
    );

    const updateGuestDeliveryAddresses = await DeliveryAddressModel.updateMany(
      { user: guestUser._id },
      { user: authUser._id }
    );

    const updateGuestWishes = await WishModel.updateMany(
      { user: guestUser._id },
      { user: authUser._id }
    );
    const updateGuestBodyMeasurementTemplates =
      await BodyMeasurementTemplateModel.updateMany(
        { user: guestUser._id },
        { user: authUser._id }
      );
    const guestBasket = await BasketModel.findOne({
      user: guestUser._id,
    }).lean();
    const guestBasketItems = guestBasket?.basketItems || [];
    if (guestBasketItems?.length > 0) {
      const alreadyExistingBasket = await BasketModel.findOne({
        user: authUser._id,
      }).lean();
      if (alreadyExistingBasket) {
        const newBasketItems =
          alreadyExistingBasket.basketItems.concat(guestBasketItems);
        await BasketModel.findByIdAndUpdate(
          alreadyExistingBasket._id,
          { basketItems: newBasketItems },
          { new: true }
        );
      } else {
        const basketId = await generateUniqueBasketId();
        const newBasket = new BasketModel({
          user: authUser._id,
          basketId,
          basketItems: guestBasketItems,
        });
        await newBasket.save();
      }
    }
    await deleteUserFromFirebase(guestUser.uid);
    await UserModel.findByIdAndDelete(guestUser._id);
    return res.status(200).send({
      data: authUser,
      message: "Guest user merged successfully to logged in password user",
    });
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
};

const mergeGoogleAppleLoginGuestUser = async (req, res) => {
  try {
    const { guestUid } = req.body;
    const getAuthUid = await getAuthUserUid(req);

    if (!getAuthUid) {
      return res.status(400).send({
        error: "current logged in Google/Apple User not found in firebase",
      });
    }
    // get firebase user
    const firebaseUser = await firebase
      .auth()
      .getUser(getAuthUid)
      .then((userRecord) => {
        if (userRecord?.uid) {
          return userRecord;
        }
        return false;
      })
      .catch((error) => {
        console.log("Error fetching user data:", error);
        return false;
      });
    if (!firebaseUser) {
      return res.status(400).send({
        error: "current logged in Google/Apple User not found in firebase",
      });
    }
    console.log("firebaseUser", firebaseUser);
    const newUid = firebaseUser.uid;
    const firstName = firebaseUser.displayName
      ? firebaseUser.displayName.split(" ")[0]
      : firebaseUser.email.split("@")[0];
    const lastName = firebaseUser.displayName
      ? firebaseUser.displayName.split(" ")[1]
      : firebaseUser.email.split("@")[0];
    const email = firebaseUser.email;

    if (!guestUid) {
      return res.status(400).send({ error: "guestUid is required" });
    }

    const guestUser = await UserModel.findOne({ uid: guestUid }).lean();
    if (!guestUser) {
      return res.status(404).send({ error: "Guest User not found" });
    }
    if (!guestUser.isGuest) {
      return res.status(400).send({ error: "User is not a guest" });
    }

    const alreadyExisting = await UserModel.findOne({
      uid: newUid,
    }).lean();

    if (alreadyExisting) {
      const updatedUser = await UserModel.findByIdAndUpdate(
        alreadyExisting._id,
        { isGuest: false, firstName, lastName, email },
        { new: true }
      );

      const guestBasket = await BasketModel.findOne({
        user: guestUser._id,
      }).lean();
      const guestBasketItems = guestBasket?.basketItems || [];
      if (guestBasketItems?.length > 0) {
        const alreadyExistingBasket = await BasketModel.findOne({
          user: alreadyExisting._id,
        }).lean();
        if (alreadyExistingBasket) {
          const newBasketItems =
            alreadyExistingBasket.basketItems.concat(guestBasketItems);
          await BasketModel.findByIdAndUpdate(
            alreadyExistingBasket._id,
            { basketItems: newBasketItems },
            { new: true }
          );
        } else {
          const basketId = await generateUniqueBasketId();
          const newBasket = new BasketModel({
            user: alreadyExisting._id,
            basketId,
            basketItems: guestBasketItems,
          });
          await newBasket.save();
        }
      }
      const updateGuestOrders = await OrderModel.updateMany(
        { user: guestUser._id },
        { user: alreadyExisting._id }
      );
      const updateGuestProductOrders = await ProductOrderModel.updateMany(
        { user: guestUser._id },
        { user: alreadyExisting._id }
      );
      const updateGuestPayments = await PaymentModel.updateMany(
        { user: guestUser._id },
        { user: alreadyExisting._id }
      );
      const updateGuestVouchers = await VoucherModel.updateMany(
        { user: guestUser._id },
        { user: alreadyExisting._id }
      );
      const updateGuestWishes = await WishModel.updateMany(
        { user: guestUser._id },
        { user: alreadyExisting._id }
      );
      const updateGuestBodyMeasurementTemplates =
        await BodyMeasurementTemplateModel.updateMany(
          { user: guestUser._id },
          { user: alreadyExisting._id }
        );
      const updateGuestDeliveryAddresses =
        await DeliveryAddressModel.updateMany(
          { user: guestUser._id },
          { user: alreadyExisting._id }
        );

      await deleteUserFromFirebase(guestUser.uid);
      await UserModel.findByIdAndDelete(guestUser._id);
      return res.status(200).send({
        data: alreadyExisting,
        message:
          "Guest user merged successfully to logged in google/apple user",
      });
    } else {
      const updatedUser = await UserModel.findOneAndUpdate(
        { uid: guestUid },
        {
          email,
          firstName,
          lastName,
          uid: newUid,
          isGuest: false,
        },
        { new: true }
      );
      if (!updatedUser) {
        return res.status(500).send({ error: "Error updating user" });
      }
      // create point for user
      const point = new PointModel({
        user: updatedUser._id,
        availablePoints: 500,
        redeemedPoints: 0,
        totalPoints: 500,
      });

      const newPoint = await point.save();
      const welcomeUserEmailTemplate = await EmailTemplateModel.findOne({
        name: "welcome-user",
      }).lean();
      const formattedUserTemplateBody = replaceUserVariablesinTemplate(
        welcomeUserEmailTemplate?.body,
        updatedUser
      );

      const formattedUserTemplateSubject = replaceUserVariablesinTemplate(
        welcomeUserEmailTemplate?.subject,
        updatedUser
      );

      const param = {
        from: "admin@zeaper.com",
        to: [email],
        subject: formattedUserTemplateSubject || "Welcome",
        body: formattedUserTemplateBody || "Welcome to Zeap",
      };
      const userMail = await sendEmail(param);
      return res.status(200).send({
        data: updatedUser,
        message:
          "Guest user merged successfully to logged in google/apple user",
      });
    }
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
};

const getUsers = async (req, res) => {
  try {
    const skip = parseInt(req.query.skip) || 0;
    const limit = parseInt(req.query.limit) || 10000;
    const sort = req.query.sort || "desc";
    const search = req.query.search || "";

    const match = {
      ...req.query,
    };
    if (search) {
      match.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }
    const query = { ...match };
    const users = await UserModel.find(query)
      .sort({ createdAt: sort })
      .skip(skip)
      .limit(limit)
      .lean();

    return res.status(200).send({ data: users });
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
};

const getUser = async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).send({ error: "userId is required" });
    }
    const user = await UserModel.findOne({ userId }).lean();

    if (!user) {
      return res.status(404).send({ error: "User not found" });
    }
    const email = user?.email;
    let userAccessRecord = {
      adminAccess: user?.isAdmin || user?.superAdmin,
    };
    let createdBy = "Self";
    if (user?.createdBy && user?.createdBy.toLowerCase() !== "self") {
      const createdByUser = await UserModel.findOne({
        userId: user.createdBy,
      }).lean();
      createdBy = createdByUser?.firstName + " " + createdByUser?.lastName;
    }

    if (email) {
      await firebase
        .auth()
        .getUserByEmail(email)
        .then((userRecord) => {
          if (userRecord?.uid) {
            userAccessRecord = {
              email: userRecord?.email,
              emailVerified: userRecord?.emailVerified,
              creationTime: userRecord?.metadata?.creationTime,
              lastSignInTime: userRecord?.metadata?.lastSignInTime,
              lastRefreshTime: userRecord?.metadata?.lastRefreshTime,
              providerId: userRecord?.providerData[0]?.providerId,
              createdBy: createdBy || "Self",
            };
          }
        })
        .catch((error) => {
          console.log("Error fetching user data:", error);
        });
    }
    user.userAccessRecord = userAccessRecord;

    return res.status(200).send({ data: user });
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
};

const getUserById = async (req, res) => {
  try {
    const { _id } = req.query;
    if (!_id) {
      return res.status(400).send({ error: "_id is required" });
    }

    const user = await UserModel.findById(_id).lean();
    const email = user?.email;

    let userAccessRecord = {
      adminAccess: user?.isAdmin || user?.superAdmin,
    };
    if (email) {
      await firebase
        .auth()
        .getUserByEmail(email)
        .then((userRecord) => {
          if (userRecord?.uid) {
            userAccessRecord = {
              email: userRecord?.email,
              emailVerified: userRecord?.emailVerified,
              creationTime: userRecord?.metadata?.creationTime,
              lastSignInTime: userRecord?.metadata?.lastSignInTime,
            };
          }
        })
        .catch((error) => {
          console.log("Error fetching user data:", error);
        });
    }
    user.userAccessRecord = userAccessRecord;

    return res.status(200).send({ data: user });
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
};

const getAdminUsers = async (req, res) => {
  try {
    const { isAdmin, disabled, superAdmin } = req.query;
    const users = await UserModel.find({
      disabled,
      $or: [{ isAdmin }, { superAdmin }],
    }).lean();
    return res.status(200).send({ data: users });
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
};

const updateUser = async (req, res) => {
  try {
    const { _id, email, phoneNumber, social } = req.body;
    if (!_id) {
      return res.status(400).send({ error: "_id is required" });
    }
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return res.status(400).send({ error: "User not authenticated" });
    }
    const isAdmin = authUser.isAdmin || authUser.superAdmin;
    if (!isAdmin && authUser._id.toString() !== _id.toString()) {
      return res.status(400).send({ error: "You are not authorized" });
    }
    const user = await UserModel.findById(_id);
    if (!user) {
      return res.status(404).send({ error: "User not found" });
    }
    if (email && email !== user.email && !user?.isGuest) {
      return res.status(400).send({ error: "email cannot be updated" });
    }
    if (email && !validator.validate(email)) {
      return res.status(400).send({ error: "email is invalid" });
    }

    if (phoneNumber !== user.phoneNumber) {
      req.body.phoneNumberVerified = false;
    }

    if (typeof req.body?.social === "string") {
      req.body.social = JSON.parse(req.body.social);
    }

    const updatedUser = await UserModel.findByIdAndUpdate(_id, req.body, {
      new: true,
    });

    return res
      .status(200)
      .send({ data: updatedUser, message: "User updated successfully" });
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
};

const validateUsers = async (ids) => {
  const invalidUser = await ids.reduce(async (acc, item) => {
    let invalid = await acc;

    const found = await UserModel.findById(item);

    if (!found) {
      invalid.push(id);
    }

    return invalid;
  }, []);
};

const deleteUser = async (contacts) => {
  return contacts.reduce(async (acc, _id) => {
    const result = await acc;
    const disabled = await UserModel.findByIdAndUpdate(
      _id,
      { disabled: true },
      { new: true }
    );
    if (!disabled) {
      result.push(_id);
    }

    return result;
  }, []);
};
const deleteUsers = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids) {
      return res.status(400).send({ error: "ids are required" });
    }
    // if ids is not an array
    if (!Array.isArray(ids)) {
      return res.status(400).send({ error: "ids must be an array" });
    }
    const invalidUsers = await validateUsers(ids);
    if (invalidUsers?.length > 0) {
      return res.status(404).send({ error: "Invalid users" });
    }
    const deletedUsers = await deleteUser(ids);
    if (deletedUsers.length > 0) {
      return res.status(500).send({ error: "Error deleting users" });
    }
    return res.status(200).send({ message: "Users deleted successfully" });
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
};
const restoreUserIds = async (ids) => {
  return ids.reduce(async (acc, _id) => {
    const result = await acc;
    const restored = await UserModel.findByIdAndUpdate(
      _id,
      { disabled: false },
      { new: true }
    );
    if (!restored) {
      result.push(_id);
    }

    return result;
  }, []);
};
const restoreUser = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids) {
      return res.status(400).send({ error: "ids are required" });
    }
    const invalidUsers = await validateUsers(ids);
    if (invalidUsers?.length > 0) {
      return res.status(404).send({ error: "Invalid users" });
    }
    const restoredUsers = await restoreUserIds(ids);
    if (restoredUsers.length > 0) {
      return res.status(500).send({ error: "Error restoring users" });
    }
    return res.status(200).send({ message: "Users restored successfully" });
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
};

const absoluteDeleteUser = async (req, res) => {
  try {
    const { _id } = req.query;
    if (!_id) {
      return res.status(400).send({ error: "_id is required" });
    }
    const user = await UserModel.findById(_id);
    if (!user) {
      return res.status(404).send({ error: "User not found" });
    }
    const deletedUser = await UserModel.findByIdAndDelete(_id);
    if (!deletedUser) {
      return res.status(500).send({ error: "Error deleting user" });
    }
    const deleteFirebaseUser = await deleteUserFromFirebase(user.uid);
    if (!deleteFirebaseUser) {
      return res
        .status(500)
        .send({ error: "Error deleting user from firebase" });
    }
    if (user.imageUrl?.name) {
      const deleteImage = await deleteImageFromFirebase(user.imageUrl.name);
      if (!deleteImage) {
        return res.status(500).send({ error: "Error deleting image" });
      }
    }
    const deleteShop = await ShopModel.findOneAndDelete({
      userId: user.userId,
    }).lean();
    if (!deleteShop) {
      return res.status(500).send({ error: "Error deleting shop" });
    }

    return res.status(200).send({ message: "User deleted successfully" });
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
};
const getUserByUid = async (req, res) => {
  try {
    const { uid } = req.query;
    if (!uid) {
      return res.status(400).send({ error: "uid is required" });
    }
    const user = await UserModel.findOne({
      uid,
    }).lean();
    if (!user) {
      return res.status(404).send({ error: "User not found" });
    }

    if (user?.disabled) {
      return res.status(404).send({ error: "User is disabled" });
    }

    return res.status(200).send({ data: user });
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
};

const uploadProfilePic = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send({ error: "no file uploaded" });
    }

    const authUser = await getAuthUser(req);
    if (!authUser) {
      return res.status(400).send({ error: "User not found" });
    }
    const _id = authUser._id;
    const filename = req.file.filename;
    const imageUrl = await addImage(req, filename);

    const user = await UserModel.findById(_id);
    if (!user) {
      return res.status(400).send({ error: "user does not exist" });
    }
    const update = await UserModel.findByIdAndUpdate(
      _id,
      { imageUrl },
      { new: true }
    );

    if (!update) return res.status(400).send({ error: "User not found" });
    await deleteImageFromFirebase(user?.imageUrl?.name);
    return res.status(200).send({ data: update });
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
};

const sendOTPToUser = async (req, res) => {
  const { userId } = req.body;
  try {
    if (!userId) {
      return res.status(400).send({ error: "userId is required" });
    }
    const user = await UserModel.findOne({ userId });
    if (!user) {
      return res.status(404).send({ error: "User not found" });
    }
    const phoneNumber = user?.phoneNumber;
    if (!phoneNumber) {
      return res.status(400).send({ error: "User has no phone number" });
    }
    const isAlreadyVerified = user?.phoneNumberVerified;
    if (isAlreadyVerified) {
      return res.status(400).send({ error: "Phone number already verified" });
    }

    const otp = await sendOTP({ to: phoneNumber, firstName: user.firstName });
  
    if (otp?.status === "200") {
      return res
        .status(200)
        .send({ data: otp, message: "OTP sent successfully" });
    }
    return res.status(500).send({
      error:
        "Error sending OTP. Ensure the phone number is correct. If issue continues, please contact admin",
    });
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
};

const verifyUserOTP = async (req, res) => {
  const { pin_id, pin, userId } = req.body;
  try {
    console.log("req.body", req.body);

    if (!pin_id) {
      return res.status(400).send({ error: "pin_id is required" });
    }
    if (!pin) {
      return res.status(400).send({ error: "pin is required" });
    }
    if (!userId) {
      return res.status(400).send({ error: "userId is required" });
    }
    const user = await UserModel.findOne({ userId });
    if (!user) {
      return res.status(404).send({ error: "User not found" });
    }
    if (user?.phoneNumberVerified) {
      return res.status(400).send({ error: "Phone number already verified" });
    }
    const otp = await verifyOTP({ pin_id, pin });
    console.log("otp", otp);
    if (otp?.status === "200") {
      const updatedUser = await UserModel.findByIdAndUpdate(
        user?._id,
        { phoneNumberVerified: true },
        { new: true }
      );
      return res.status(200).send({
        data: updatedUser,
        message: "Phone number verified successfully",
      });
    }
    return res.status(500).send({
      error:
        "Error verifying OTP. Ensure the pin is correct and not expired. Note that it expires after 15 mins. If issue continues, please contact admin",
    });
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
};
const getUserInfoByEmail = async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).send({ error: "email is required" });
    }
    const user = await UserModel.findOne({
      email: { $regex: email, $options: "i" },
    }).lean();
    const data = {};
    if (user) {
      data.firstName = user.firstName;
      data.lastName = user.lastName;
      data.email = user.email;
    }
    return res.status(200).send({ data });
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
};

module.exports = {
  createUser,
  createUserWithGoogleOrApple,
  creatGuestUser,
  getUsers,
  getUser,
  getUserById,
  getUserInfoByEmail,
  getAdminUsers,
  updateUser,
  deleteUsers,
  restoreUser,
  absoluteDeleteUser,
  getUserByUid,
  uploadProfilePic,
  verifyUserOTP,
  sendOTPToUser,
  convertGuestUserWithEmailPasswordProvider,
  mergeGoogleAppleLoginGuestUser,
  mergePasswordLoginGuestUser,
  getRecommendedCurrency,
};
