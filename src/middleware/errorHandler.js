// Central error handling. Register AFTER all routes:
//   app.use(notFound);
//   app.use(errorHandler);
export function notFound(req, res, next) {
  res.status(404).json({ message: `Not found - ${req.originalUrl}` });
}

export function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  console.error(err);
  const isProd = process.env.NODE_ENV === 'production';
  // In production, only surface messages for client (4xx) errors or errors
  // explicitly marked safe (err.expose). Never leak raw 5xx internals — a Mongo
  // E11000 or driver message discloses schema/indexes and enables enumeration.
  const showMessage = !isProd || err.expose === true || (status >= 400 && status < 500);
  res.status(status).json({
    message: showMessage ? (err.message || 'Server error') : 'Server error',
    ...(isProd ? {} : { stack: err.stack }),
  });
}
