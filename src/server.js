import 'dotenv/config';
import { app } from './app.js';
import connectDB from './config/db.js';

// Connect to MongoDB
connectDB();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API listening on ${PORT}`));
