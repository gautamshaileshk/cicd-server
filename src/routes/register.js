import express from 'express';
import User from '../models/user.js';
const router = express.Router();

router.post('/', async (req, res) => {
  const { name, email, password, role } = req.body;
  try {
    if (!name || !email || !password || !role) {
      return res.status(400).json({ msg: 'All fields are required' });
    }
    const user = await User.create({ name, email, password, role });
    res.status(201).json({ user,msg: 'User created successfully' });
  } catch (error) {
    console.log(error);
    res.status(500).json({ msg: 'Server error' });
  }
});

export default router;
