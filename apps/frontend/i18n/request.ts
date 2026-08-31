import { getRequestConfig } from 'next-intl/server';
import { locales, defaultLocale, isLocale } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !isLocale(locale)) {
    locale = defaultLocale;
  }

  return {
    locale,
  };
});
