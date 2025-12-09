const Stripe = require("stripe");
const { ENV } = require("../config");
const stripeKey =
  ENV === "dev"
    ? process.env.STRIPE_SECRET_KEY_TEST
    : process.env.STRIPE_SECRET_KEY_LIVE;

const stripe = new Stripe(stripeKey, {
  apiVersion: "2024-06-20", // keep current
});

/**
 * Verifies a Stripe payment by PaymentIntent ID.
 * Returns: { paymentIntent, log }
 */
async function verifyStripePayment(paymentIntentId) {
  if (!paymentIntentId) {
    throw new Error("PaymentIntent ID missing");
  }

  try {
    // Retrieve the full PaymentIntent
    const paymentIntent = await stripe.paymentIntents.retrieve(
      paymentIntentId,
      {
        expand: ["payment_method", "charges.data.balance_transaction"],
      }
    );

    // Validate payment
    if (!paymentIntent) {
      throw new Error("PaymentIntent not found");
    }

    if (paymentIntent.status !== "succeeded") {
      throw new Error("Payment not successful");
    }

    // Fetch Stripe logs for debugging / audit
    const events = await stripe.events.list({ limit: 50 });

    const filteredEvents = events.data.filter(
      (event) => event.data.object?.id === paymentIntent.id
    );

    // Format event logs for storage
    const log = filteredEvents.map((event) => ({
      id: event.id,
      type: event.type,
      created: new Date(event.created * 1000),
      data: event.data.object,
    }));

    return {
      paymentIntent,
      log,
    };
  } catch (error) {
    throw new Error(
      error.message || "Failed to verify Stripe payment. Please try again."
    );
  }
}

module.exports = {
  verifyStripePayment,
};
