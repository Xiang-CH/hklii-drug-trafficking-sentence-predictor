import '#nitro/virtual/polyfills'
import { parseURL } from 'ufo'
import { useNitroApp } from 'nitro/app'
import { getAzureParsedCookiesFromHeaders } from './_utils.mjs'

const nitroApp = useNitroApp()

function resolveBaseUrl(req) {
  const forwardedProto = req.headers['x-forwarded-proto']
  const forwardedHost = req.headers['x-forwarded-host']
  const host = forwardedHost || req.headers['host']
  if (host) {
    return `${forwardedProto || 'http'}://${host}`
  }
  const originalUrl = req.headers['x-ms-original-url']
  if (originalUrl) {
    try {
      return new URL(originalUrl).origin
    } catch {
      // ignore invalid original URL
    }
  }
  return 'http://localhost'
}

export async function handle(context, req) {
  let url
  if (req.headers['x-ms-original-url']) {
    // This URL has been proxied as there was no static file matching it.
    const parsedURL = parseURL(req.headers['x-ms-original-url'])
    url = parsedURL.pathname + parsedURL.search
  } else {
    // Because Azure SWA handles /api/* calls differently they
    // never hit the proxy and we have to reconstitute the URL.
    url = '/api/' + (req.params.url || '')
  }
  const request = new Request(new URL(url, resolveBaseUrl(req)), {
    method: req.method || undefined,
    headers: new Headers(req.headers),
    body: req.bufferBody ?? req.rawBody,
  })
  const response = await nitroApp.fetch(request)
  const body = response.body
    ? Buffer.from(await response.arrayBuffer())
    : undefined
  // (v3 - current) https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node?tabs=typescript%2Cwindows%2Cazure-cli&pivots=nodejs-model-v3#http-response
  // (v4) https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node?tabs=typescript%2Cwindows%2Cazure-cli&pivots=nodejs-model-v4#http-response
  context.res = {
    status: response.status,
    body,
    cookies: getAzureParsedCookiesFromHeaders(response.headers),
    headers: Object.fromEntries(
      [...response.headers.entries()].filter(([key]) => key !== 'set-cookie'),
    ),
  }
}
