export async function readBrief(file) {
  if (!file || !file.size || file.size > 5 * 1024 * 1024)
    throw new Error("Choose a text or readable PDF brief up to 5 MB.");
  let text;
  if (/\.txt$/i.test(file.name) || file.type === "text/plain")
    text = await file.text();
  else if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
    // Load the PDF engine only when requested. Files stay in this browser.
    const [{ getDocument, GlobalWorkerOptions }, { default: workerUrl }] =
      await Promise.all([
        import("pdfjs-dist/build/pdf.mjs"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
    GlobalWorkerOptions.workerSrc = workerUrl;
    const task = getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      isEvalSupported: false,
      useWasm: false,
      useWorkerFetch: false,
    });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 20)
        throw new Error(
          "Choose up to 20 pages, or paste only the requested work from this brief.",
        );
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        // Reconstruct text lines; never claim support for scanned images/OCR.
        const lines = [];
        let line = "",
          y;
        for (const item of content.items) {
          if (!("str" in item)) continue;
          if (y !== undefined && Math.abs(item.transform[5] - y) > 3 && line) {
            lines.push(line.trim());
            line = "";
          }
          line += `${item.str} `;
          y = item.transform[5];
          if (item.hasEOL) {
            lines.push(line.trim());
            line = "";
            y = undefined;
          }
        }
        if (line.trim()) lines.push(line.trim());
        if (!lines.some((line) => line.trim()))
          throw new Error(
            `Page ${i} has no readable text. Paste its relevant work requests; image-only pages are not read automatically.`,
          );
        pages.push(`[Page ${i}]\n${lines.join("\n")}`);
        if (pages.join("\n\n").length > 6000)
          throw new Error(
            "This brief is too long for one review. Paste its work requests in smaller sections.",
          );
        page.cleanup();
      }
      text = pages.join("\n\n");
      if (!text.replace(/\[Page \d+\]/g, "").trim())
        throw new Error(
          "This PDF has no readable text. Copy the work requests from the original, or use ChatGPT to read it first.",
        );
    } catch (error) {
      if (error.name === "PasswordException")
        throw new Error(
          "This PDF is password protected. Paste the relevant work requests instead.",
        );
      throw error;
    } finally {
      await task.destroy();
    }
  } else throw new Error("Choose a .txt or .pdf brief, or paste its wording.");
  if (text.length > 6000)
    throw new Error(
      "Use up to 6,000 characters at a time. The original file has not been changed.",
    );
  return {
    text,
    sourceName: file.name.slice(0, 200),
    suggestions: [],
    reviewed: false,
  };
}
