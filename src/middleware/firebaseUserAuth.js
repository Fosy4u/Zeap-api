const { firebase } = require("../config/firebase");
const UserModel = require("../models/user");
const ObjectId = require("mongoose").Types.ObjectId;

function isValidObjectId(id) {
  if (ObjectId.isValid(id)) {
    if (String(new ObjectId(id)) === id) return true;
    return false;
  }
  return false;
}
const getToken = (request) => {
  const headerToken = request.headers.authorization;
  if (!headerToken) {
    console.log("No token provided");
    return response.status(401).send({ message: "No token provided" });
  }

  if (headerToken && headerToken.split(" ")[0] !== "Bearer") {
    console.log("Invalid token");
    return response.status(401).send({ message: "Invalid token" });
  }

  const token = headerToken.split(" ")[1];
  return token;
};

const authMiddleware = (request, response, next) => {
  const token = getToken(request);

  firebase
    .auth()
    .verifyIdToken(token)
    .then((res) => {
  
      next();
    })
    .catch((error) => {
      console.log("error in verifying token", error);
      response.send({ message: "Could not authorize", error }).status(400);
    });
};
const getAuthUser = async (request) => {
  const token = getToken(request);
  const authUser = await firebase.auth().verifyIdToken(token);
 
  if (!authUser) {
    return null;
  }
  const uid = authUser.uid;
  const user = await UserModel.findOne({ uid });
  if (!user) {
    return false;
  }
  return user;
};

module.exports = {
  authMiddleware,
  getAuthUser,
};
