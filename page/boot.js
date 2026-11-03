(async () => {
  const theme = await window.magpie?.ready;
  const config = (await window.magpie?.options?.get?.()) || {};
  const port = Number(config.port || 45890);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid Speed service port.');
  let service = window.magpie?.service;
  if (!service) {
    // The desktop window serves its pages from the webview's own origin:
    // wails://localhost on macOS/Linux and http://wails.localhost on Windows.
    // Everything under .localhost resolves to loopback, like 127.0.0.1.
    const host = location.hostname;
    const local =
      !host ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]';
    if (!local) {
      document.getElementById('status').textContent =
        '请升级 Magpie 以支持远程插件服务，或将服务器的服务端口通过 SSH 转发到本机。';
      return;
    }
    service = `http://127.0.0.1:${port}/`;
  }
  const url = new URL(service, location.href);
  // Magpie web proxies this service under its own origin. A sandboxed frame
  // needs that concrete origin in connect-src; 'self' can resolve to null.
  url.searchParams.set('uiOrigin', url.origin);
  if (theme) {
    url.searchParams.set('theme', theme.dark ? 'dark' : 'light');
    if (theme.lang) url.searchParams.set('lang', theme.lang);
  }
  const context = window.magpie?.context?.provider;
  if (context?.id) url.searchParams.set('provider', context.id);
  window.magpie?.onAction((action) => {
    if (action?.provider?.id) {
      url.searchParams.set('provider', action.provider.id);
      location.replace(url.href);
    }
  });
  location.replace(url.href);
})().catch((e) => {
  document.getElementById('status').textContent = String(e?.message || e);
});
