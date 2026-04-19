import { afterEach, describe, expect, it } from 'vitest';

import { isWeChatBypassingProxy, updateWeChatNoProxy } from './config.js';

describe('updateWeChatNoProxy', () => {
  const originalNoProxy = process.env.NO_PROXY;
  const originalNoProxyLower = process.env.no_proxy;

  afterEach(() => {
    if (originalNoProxy === undefined) {
      delete process.env.NO_PROXY;
    } else {
      process.env.NO_PROXY = originalNoProxy;
    }

    if (originalNoProxyLower === undefined) {
      delete process.env.no_proxy;
    } else {
      process.env.no_proxy = originalNoProxyLower;
    }
  });

  it('adds and removes WeChat domains based on bypassProxy', () => {
    process.env.NO_PROXY = 'localhost,127.0.0.1';
    process.env.no_proxy = process.env.NO_PROXY;

    updateWeChatNoProxy(true);

    expect(isWeChatBypassingProxy()).toBe(true);
    expect(process.env.NO_PROXY).toContain('ilinkai.weixin.qq.com');
    expect(process.env.NO_PROXY).toContain('novac2c.cdn.weixin.qq.com');

    updateWeChatNoProxy(false);

    expect(isWeChatBypassingProxy()).toBe(false);
    expect(process.env.NO_PROXY).toBe('localhost,127.0.0.1');
  });
});
