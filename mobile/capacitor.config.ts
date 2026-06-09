import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.msfgco.dashboard',
  appName: 'MSFG Dashboard',
  webDir: 'www',
  server: {
    url: 'https://dashboard.msfgco.com',
    cleartext: false,
    allowNavigation: [
      'dashboard.msfgco.com',
      'api.msfgco.com',
      '*.amazoncognito.com'
    ]
  },
  ios: {
    contentInset: 'automatic'
  }
};

export default config;
