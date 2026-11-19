import { createHashRouter, type RouteObject } from 'react-router';
import { BootScreen } from './BootScreen';
import { DesignGallery } from '../features/gallery/DesignGallery';

// Hash routing: required for static zero-server hosting and #/sms-ingest fragment ingestion (Phase 5).
// The Design Gallery exists in dev and E2E builds only (VITE_E2E is set by the Playwright web server).
const devRoutes: RouteObject[] = import.meta.env.DEV || import.meta.env.VITE_E2E === '1' ? [{ path: '/gallery', element: <DesignGallery /> }] : [];

export const router = createHashRouter([...devRoutes, { path: '*', element: <BootScreen /> }]);
