/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
  async fetch(request, env, ctx) {
    try {
//        const auth = request.headers.get('Authorization');
//        const expectedAuth = `Bearer ${env.AUTH_SECRET}`;
        const url = new URL(request.url);
	  	const pathSegments = url.pathname.split('/');

	  	if (pathSegments.length !== 4 || pathSegments[1] !== 'projects' || !pathSegments[2] || pathSegments[3] !== 'logo') {
			return new Response('Invalid URL format', { status: 400 });
	  	}
//        if (!auth || auth !== expectedAuth) {
//          return new Response('Unauthorized', { status: 401 });
//        }

		//expected format /projects/{projectId}/logo
	  	const projectId = pathSegments[2];

	  	if (!projectId) {
			return new Response('File ID missing', { status: 400 });
	  	}


       	if (request.method === 'PUT') {
          return await handlePost(request, env, projectId);
        }else if (request.method === 'GET') {
          return await handleGet(request, env, ctx, projectId);
        }
        return new Response('Method not allowed', { status: 405 });
    } catch (error) {
    	console.error('Unexpected error:', error);
    	return new Response('Internal Server Error', { status: 500 });
    }
  }
};

async function handlePost(request, env, ctx, projectId) {
  const contentType = request.headers.get('Content-Type') || '';

  // File type validation (adjust as needed)
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
  if (!allowedTypes.includes(contentType)) {
    return new Response('File type not allowed', { status: 400 });
  }

  // Check content length
  const contentLength = request.headers.get('Content-Length');
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  if (!contentLength || parseInt(contentLength) > MAX_FILE_SIZE) {
    return new Response('File size exceeds limit or is not specified', { status: 400 });
  }

  const extension = contentType.split('/')[1];
  const filename = `${projectId}.${extension}`;

  // Read the request body as an ArrayBuffer
  const arrayBuffer = await request.arrayBuffer();
  const imageCategory = 'logo'

  // Upload to R2
  await env.MY_BUCKET.put(projectId, arrayBuffer, {
    httpMetadata: { contentType: contentType },
    customMetadata: {
    	originalContentType: contentType,
        imageCategory: imageCategory
        }
  });

  const workerUrl = `${request.url}`;
  return corsResponse(JSON.stringify({ url: workerUrl }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleGet(request, env, ctx, projectId) {

  const cache = caches.default;
  let response = await cache.match(request);

  if (!response) {
    const object = await env.MY_BUCKET.get(projectId);

    if (!object) {
      return new Response('File not found', { status: 404 });
    }

    const contentType = object.httpMetadata.contentType || object.customMetadata.originalContentType || 'application/octet-stream';

    response = new Response(object.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'",
        'X-Content-Type-Options': 'nosniff',
        'X-Image-Category': object.customMetadata.imageCategory || 'unknown'
      },
    });

    ctx.waitUntil(cache.put(request, response.clone()));
  }

  return corsResponse(response);
}

function corsResponse(response, options = {}) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (response instanceof Response) {
    const newResponse = new Response(response.body, response);
    Object.entries(corsHeaders).forEach(([key, value]) => newResponse.headers.set(key, value));
    return newResponse;
  } else {
    return new Response(response, {
      ...options,
      headers: { ...corsHeaders, ...options.headers }
    });
  }
}
