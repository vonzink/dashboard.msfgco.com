// CloudFront Function: msfg-rewrite-login
// Runtime: cloudfront-js-2.0
// Associated with: Default behavior on distribution E3QTH6K640MMKK
//
// Purpose:
//   1. Rewrite /login and /login-callback to their .html files (S3 origin)
//   2. Redirect bare /calc to /calc/ so it matches the calc/* cache behavior (EC2 origin)

function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // Rewrite clean URLs to actual files
  if (uri === "/login" || uri === "/login/") {
    request.uri = "/login.html";
  }

  if (uri === "/login-callback" || uri === "/login-callback/") {
    request.uri = "/login-callback.html";
  }

  // Redirect bare /calc to /calc/ (matches calc/* cache behavior)
  if (uri === "/calc") {
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: {
        "location": { value: "/calc/" }
      }
    };
  }

  return request;
}
