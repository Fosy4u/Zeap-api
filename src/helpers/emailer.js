const nodemailer = require("nodemailer");
const creds = require("../config/nodemailerConfig");
const { ENV } = require("../config");
const generatePdf = require("./pdf");

const url =
  ENV === "prod"
    ? process.env.DOC_DOWNLOAD_URL_PROD
    : process.env.DOC_DOWNLOAD_URL_DEV;
const transport = {
  host: "mail.privateemail.com", // your_host_here
  // host: "smtp.mail.yahoo.com.", // your_host_here
  auth: {
    user: creds.USER,
    pass: creds.PASS,
    authMethod: "PLAIN",
  },
  tls: {
    rejectUnauthorized: false,
  },
  port: 465,
};
const transporter = nodemailer.createTransport(transport);
transporter.verify((error, success) => {
  if (error) {
    console.log("error with nodemailer transporter", error);
  } else {
    console.log("All works fine, nodemailer transporter is ready");
  }
});

const sendEmail = async (param) => {
  try {
    const {
      from,
      to,
      subject,
      body,
      replyTo,
      cc,
      bcc,
      attach,

      order_id,
      fileName,
    } = param;
    if (!from || !to || !subject || !body) {
      return { error: "All fields are required" };
    }

    if (!order_id && attach) {
      return { error: "Id is required" };
    }

    let pdf;
    let attachments = [];

    if (attach) {
      const website_url = `${url}/${order_id}`;
      console.log("website_url", website_url);
      const MIN_PDF_BYTES = 15000;
      let attempts = 0;

      while (attempts < 2) {
        attempts += 1;
        pdf = await generatePdf({
          type: "url",
          website_url,
        });

        if (pdf && pdf.length >= MIN_PDF_BYTES) {
          break;
        }

        // Give the receipt page a moment and retry once for slow SPA renders.
        await new Promise((resolve) => setTimeout(resolve, 4000));
      }

      if (!pdf || pdf.length < MIN_PDF_BYTES) {
        throw new Error("Unable to generate a non-empty receipt PDF");
      }

      const today = new Date();
      const pdfFilename = fileName
        ? `${fileName}.pdf`
        : `${order_id}-${today.getFullYear()}-${today.getMonth()}-${today.getDate()}.pdf`;
      attachments = [
        {
          filename: pdfFilename,
          content: pdf,
          contentType: "application/pdf",
        },
      ];
    }

    const mail = {
      from,
      to: to?.map((email) => email),
      subject,
      html: body,
      attachDataUrls: true,
      replyTo: replyTo,
      cc: cc?.map((email) => email),
      bcc: bcc?.map((email) => email),
      attachments,
    };

    const response = await transporter.sendMail(mail, (err, data) => {
      if (err) {
        console.log("err", err);
        return { error: err.message };
      }
    });

    return { data: "Email sent successfully" };
  } catch (error) {
    return { error: error.message };
  }
};

module.exports = {
  sendEmail,
};
