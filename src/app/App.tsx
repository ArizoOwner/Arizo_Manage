import { RouterProvider } from 'react-router';
import { AutoLockManager, PrivacyCurtain } from './AutoLockManager';
import { router } from './router';
import { UpdatePrompt } from './UpdatePrompt';

export function App() {
  return (
    <>
      <RouterProvider router={router} />
      <AutoLockManager />
      <PrivacyCurtain />
      <UpdatePrompt />
    </>
  );
}
