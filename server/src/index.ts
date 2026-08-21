import express from 'express';
import cors from 'cors';
import { api } from './routes/api.js';
import { bootstrapControlPlane } from './store/bootstrap.js';

const PORT = Number(process.env.PORT ?? 8787);

bootstrapControlPlane();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/api', api);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`SENTINEL authorization gateway listening on http://localhost:${PORT}`);
});
