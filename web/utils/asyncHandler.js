// Express 4 does not forward rejected promises from async route handlers to the
// error middleware automatically — an unhandled rejection there crashes the whole
// process. Wrap every async route/middleware with this so failures (e.g. Discord
// API being temporarily unreachable) render a friendly error page instead.
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
