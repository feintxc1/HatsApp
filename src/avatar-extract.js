module.exports = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40; i++) {
    if (typeof window.require === "function") break;
    await sleep(250);
  }
  if (typeof window.require !== "function") return null;

  const toDataUrl = async (url) => {
    if (!url || typeof url !== "string") return null;
    if (url.startsWith("data:image")) return url;
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob || !blob.size) return null;
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const fromThumb = async (thumb) => {
    if (!thumb) return null;
    const url = thumb.eurl || thumb.img || thumb.previewEurl || thumb.imgFull || null;
    if (!url) return null;
    return await toDataUrl(url);
  };

  try {
    if (typeof window.require !== "function") return null;

    const meMod = window.require("WAWebUserPrefsMeUser");
    const me =
      (meMod.getMaybeMePnUser && meMod.getMaybeMePnUser()) ||
      (meMod.getMaybeMeLidUser && meMod.getMaybeMeLidUser()) ||
      null;
    if (!me) return null;

    const collections = window.require("WAWebCollections");
    const thumbs = collections.ProfilePicThumb;
    let thumb = null;
    try {
      thumb = thumbs.get(me) || thumbs.get(me._serialized) || null;
    } catch {}
    if (!thumb && thumbs.find) {
      try {
        thumb = await thumbs.find(me);
      } catch {}
    }

    let dataUrl = await fromThumb(thumb);
    if (dataUrl) return dataUrl;

    try {
      const bridge = window.require("WAWebContactProfilePicThumbBridge");
      if (bridge.requestProfilePicFromServer) {
        const chat =
          collections.Contact?.get(me) ||
          collections.Contact?.get(me._serialized) ||
          me;
        const result = await bridge.requestProfilePicFromServer(chat);
        dataUrl = await fromThumb(result);
        if (dataUrl) return dataUrl;
        if (result?.eurl) return await toDataUrl(result.eurl);
      }
    } catch {}

    try {
      thumb = thumbs.get(me) || thumbs.get(me._serialized) || null;
      dataUrl = await fromThumb(thumb);
      if (dataUrl) return dataUrl;
    } catch {}
  } catch {}

  return null;
})()`;
