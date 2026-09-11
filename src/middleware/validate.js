import { ZodError } from 'zod';

// Validate part of the request against a Zod schema. Replaces req[source] with the
// parsed/coerced data on success. Use as middleware:
//   router.post('/', validate(userSchema), handler);          // validates req.body
//   router.get('/', validate(querySchema, 'query'), handler); // validates req.query
const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const errors = (result.error instanceof ZodError ? result.error.issues : []).map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    return res.status(400).json({ message: 'Validation failed', errors });
  }
  req[source] = result.data;
  next();
};

export default validate;
