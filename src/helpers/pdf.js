const puppeteer = require("puppeteer");
const path = require("path");
const root = require("../../root");
const fs = require("fs");

const generatePdf = async (param) => {
  const { type, website_url, usePath, filename } = param;

  // Create a browser instance
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  // Create a new page
  const page = await browser.newPage();

  if (type === "url") {
    // Web site URL to export as pdf
    //   const website_url = 'https://www.bannerbear.com/blog/how-to-download-images-from-a-website-using-puppeteer/';

    // Open URL in current page

    await page.goto(website_url, { waitUntil: "networkidle0" });

    // Wait until a visible receipt-like payload exists, not just the SPA shell.
    try {
      await page.waitForFunction(
        () => {
          const bodyText = (document.body?.innerText || "")
            .replace(/\s+/g, " ")
            .trim();
          const hasReceiptText = /Receipt to|Order ID|Subtotal|Total/i.test(
            bodyText,
          );

          const hasVisibleTextNode = Array.from(
            document.querySelectorAll("body *"),
          ).some((el) => {
            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden") {
              return false;
            }
            return (el.innerText || "").trim().length > 0;
          });

          return hasReceiptText && hasVisibleTextNode;
        },
        { timeout: 30000 },
      );
    } catch (error) {
      // Fallback for slow client-side rendering in production.
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    // Ensure web fonts finish loading before PDF snapshot.
    await page.evaluate(() => document.fonts?.ready);
  } else if (type === "file") {
    //Get HTML content from HTML file

    const html = fs.readFileSync(
      path.join(root + "/templates/index.html"),
      "utf-8",
    );
    await page.setContent(html, { waitUntil: "domcontentloaded" });
  } else {
    console.log(new Error(`HTML source "${type}" is unkown.`));
    await browser.close();
    return;
  }

  // To reflect CSS used for screens instead of print
  await page.emulateMediaType("screen");

  // Downlaod the PDF
  const pdf = await page.pdf({
    // if you want to save the pdf in a file then use path
    ...(usePath && {
      path: `${path.join(root)}/templates/converted/result_${type}.pdf`,
    }),
    margin: { top: "100px", right: "50px", bottom: "100px", left: "50px" },
    printBackground: true,
    format: "A4",
  });

  // Close the browser instance
  await browser.close();
  // return {
  //   pdf,
  //   path : `${path.join(root)}/templates/converted/result_${type}.pdf`
  // }
  return pdf;
};

module.exports = generatePdf;
