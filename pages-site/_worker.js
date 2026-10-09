// Forwards account and order requests to the "sales" Worker. Everything else
// on the site is a static file served by Pages directly.
export default {
  async fetch(request, env) {
    const {pathname} = new URL(request.url);
    if (pathname.startsWith('/api/') || pathname.startsWith('/auth/')) {
      if (!env.API) {
        return Response.json({error: 'საიტს Cloudflare-ზე გამართვა სჭირდება.'}, {status: 503, headers: {'Cache-Control': 'no-store'}});
      }
      return env.API.fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};
