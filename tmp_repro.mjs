import puppeteer from "puppeteer-core";

const exe = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browser = await puppeteer.launch({
  executablePath: exe,
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const page = await browser.newPage();
page.on("console", (m) => console.log("[console]", m.type(), m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await page.goto("http://localhost:8088/", { waitUntil: "networkidle0" });

// open Development / Create
await page.evaluate(() => {
  const item = [...document.querySelectorAll(".nav-item")].find((n) => n.dataset.target === "development-create");
  item.click();
});
await new Promise((r) => setTimeout(r, 400));

// fill company via typeahead
await page.type("#dev-company", "aaa", { delay: 20 });
await new Promise((r) => setTimeout(r, 300));
// select first match
await page.evaluate(() => {
  const li = document.querySelector("#dev-company-list .combobox-item");
  if (li) li.click();
});
await new Promise((r) => setTimeout(r, 400));

// pick a member
const memberVal = await page.evaluate(() => {
  const sel = document.querySelector("#dev-member");
  // choose first non-empty option
  const opt = [...sel.options].find((o) => o.value !== "");
  if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event("change", { bubbles: true })); }
  return sel.value;
});
console.log("member selected:", memberVal);

// item name
await page.type("#dev-item", "fewaf", { delay: 20 });
// product type
await page.select("#dev-product", "raised silicon label");
// raised/silicon details
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  const set = (id, v) => { const el = document.querySelector(id); if (el) { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); } };
  set("#dev-height", "11");
  set("#dev-width", "112");
  set("#dev-raised-height", "0.0");
  set("#dev-no-of-color", "1");
  set("#dev-pantone-0", "19-1101");
});
await new Promise((r) => setTimeout(r, 300));

// dummy to attach an image (one image)
await page.evaluate(() => document.querySelector("#dev-dummy").click());
await new Promise((r) => setTimeout(r, 600));

// check state
const state = await page.evaluate(() => {
  const sb = document.querySelector("#dev-save");
  return {
    saveDisabled: sb.disabled,
    saveActive: sb.classList.contains("active"),
    images: devState.images.length,
    companyId: devState.companyId,
    memberId: devState.memberId,
    item: devState.item,
    product: devState.product,
    hiddenVal: document.querySelector("#dev-company-id").value,
    memberVal: document.querySelector("#dev-member").value,
  };
});
console.log("STATE:", JSON.stringify(state, null, 2));

await browser.close();
