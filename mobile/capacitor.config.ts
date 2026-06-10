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
      'us-west-1s6ie2uego.auth.us-west-1.amazoncognito.com'
    ]
  },
  ios: {
    contentInset: 'automatic'
  }
};

export default config;
