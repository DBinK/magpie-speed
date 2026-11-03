// Magpie loads this module in its plugin host. Its presence makes magpie
// treat the package as more than a page (plugin.Gateway is what
// InMagpieOnly checks first), so the host starts and the page service in
// index.mjs runs. No request is touched.
export function onRequest(_ctx, next) {
  return next();
}
