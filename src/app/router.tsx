import { createHashRouter } from 'react-router';
import { BootScreen } from './BootScreen';

// Hash routing: required for static zero-server hosting and #/sms-ingest fragment ingestion (Phase 5).
export const router = createHashRouter([{ path: '*', element: <BootScreen /> }]);
