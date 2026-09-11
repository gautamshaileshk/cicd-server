// Role-based access control. Use AFTER the JWT auth middleware so req.user is set:
//   router.get('/admin', auth, roles('admin'), handler);
// Requires the login token payload to include a `role` (e.g. jwt.sign({ id, role })).
const roles = (...allowed) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  if (allowed.length && !allowed.includes(req.user.role)) {
    return res.status(403).json({ message: 'Forbidden: insufficient role' });
  }
  next();
};

export default roles;
