const { ENV } = require("../config");
const request = require("request");
const secretKey =
  ENV === "dev"
    ? process.env.PAYSTACK_SECRET_TEST_KEY
    : process.env.PAYSTACK_SECRET_LIVE_KEY;

const verifyPaystack = (ref, mycallback) => {
  const options = {
    url:
      "https://api.paystack.co/transaction/verify/" + encodeURIComponent(ref),
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/json",
      "cache-control": "no-cache",
    },
  };
  const callback = (error, response, body) => {
    return mycallback(error, body);
  };
  request(options, callback);
};
function verifyPaystackPayment(reference) {
  return new Promise((resolve, reject) => {
    verifyPaystack(reference, (error, body) => {
      if (error) return reject(error);

      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (e) {
        reject(e);
      }
    });
  });
}

module.exports = {
  verifyPaystackPayment,
  verifyPaystack,
};
