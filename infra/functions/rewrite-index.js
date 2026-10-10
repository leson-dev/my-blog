// CloudFront Function (cloudfront-js-2.0), viewer request on the blog distribution.
// S3 REST origins have no directory index: serve /vi/ and /vi/tags/life from index.html.
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith("/")) {
    request.uri = uri + "index.html";
  } else if (uri.split("/").pop().indexOf(".") === -1) {
    request.uri = uri + "/index.html";
  }
  return request;
}
