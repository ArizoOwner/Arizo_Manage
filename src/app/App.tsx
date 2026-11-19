import { RouterProvider } from 'react-router';
import { router } from './router';
import { UpdatePrompt } from './UpdatePrompt';

export function App() {
  return (
    <>
      <RouterProvider router={router} />
      <UpdatePrompt />
    </>
  );
}
