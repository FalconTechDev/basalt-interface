// Compatibility entry for tests/tools that import the publish module path.
// g12: implementation lives in n-g12-s24-site.js / n-g12-s24-app.js (clean-room rewrite).
import { ng12PublishSite } from "./n-g12-s24-site.js";
import { ng12PublishSearch, ng12PublishApp } from "./n-g12-s24-app.js";

export { ng12PublishSite as s24PublishSite };
export { ng12PublishSearch as s24PublishSearch };
export { ng12PublishApp as s24PublishApp };
