import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.arizo.manage',
  appName: 'Arizo Manage',
  webDir: 'dist',
  backgroundColor: '#06080D',
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
