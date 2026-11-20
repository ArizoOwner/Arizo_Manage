// Side-effect import, first in main.tsx: wipes `#/sms-ingest?d=…` before the hash router reads the URL.
import { captureIngestFragment } from '../features/sms-intelligence/intake';

captureIngestFragment();
