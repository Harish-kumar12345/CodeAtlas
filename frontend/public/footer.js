// frontend/public/footer.js
// Renders the professional 3-column footer across all pages.
// Details are managed in window.LEETMATRIC_FOOTER_CONFIG (footer-config.js).

(function () {
  const DEFAULT_CONFIG = {
    name: "Harish Kumar",
    tagline: "Full-stack developer",
    github: "https://github.com/Harish-kumar12345",
    linkedin: "https://www.linkedin.com/in/harish-kumar-49763039b/",
    repo: "https://github.com/Harish-kumar12345/LeetMatric",
    emailUser: "harishkumarup286",
    emailDomain: "gmail.com",
    brandName: "LeetMatric",
    brandDesc: "Track, analyze, and master your coding journey across LeetCode, Codeforces, and CodeChef in one unified daily companion.",
    techStack: "Built with Node.js, Express, SQLite & Vanilla JS",
    disclaimer: "LeetCode and other platform names belong to their respective owners. This project is not affiliated with them."
  };

  const config = Object.assign({}, DEFAULT_CONFIG, window.LEETMATRIC_FOOTER_CONFIG || {});

  // Dynamically assemble email address to prevent scraping bots
  const emailAddress = `${config.emailUser}@${config.emailDomain}`;
  const currentYear = new Date().getFullYear();

  // Inline SVG icons
  const ICONS = {
    brand: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    github: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>`,
    linkedin: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 8.76a1.69 1.69 0 1 0 0-3.38 1.69 1.69 0 0 0 0 3.38m1.39 9.74v-8.37H5.07v8.37h2.78z"/></svg>`,
    email: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`,
    star: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`
  };

  function buildFooterHTML() {
    return `
      <div class="footer-inner">
        <div class="footer-grid">
          <!-- Column 1: Brand & Author -->
          <div class="footer-col-brand">
            <a href="/" class="footer-brand-title">
              <span class="footer-brand-icon">${ICONS.brand}</span>
              <span>${config.brandName}</span>
            </a>
            <p class="footer-brand-desc">${config.brandDesc}</p>
            <div class="footer-author-box">
              <div class="footer-author-line">
                Built with <span class="footer-heart" aria-label="love">♥</span> by <strong>${config.name}</strong>
              </div>
              <span class="footer-author-tagline">${config.tagline}</span>
            </div>
          </div>

          <!-- Column 2: Quick Links (Existing Pages Only) -->
          <div class="footer-col-nav">
            <div class="footer-heading">Quick Links</div>
            <ul class="footer-nav-list">
              <li><a href="/" class="footer-nav-link">Home / Search</a></li>
              <li><a href="/#features" class="footer-nav-link">Platform Features</a></li>
              <li><a href="/login.html" class="footer-nav-link">Sign in</a></li>
              <li><a href="/register.html" class="footer-nav-link">Create Account</a></li>
              <li><a href="/settings.html" class="footer-nav-link">Account Settings</a></li>
              <li><a href="https://leetcode.com" target="_blank" rel="noopener noreferrer" class="footer-nav-link">LeetCode ↗</a></li>
            </ul>
          </div>

          <!-- Column 3: Connect -->
          <div class="footer-col-connect">
            <div class="footer-heading">Connect</div>
            <ul class="footer-connect-list">
              <li>
                <a href="${config.github}" target="_blank" rel="noopener noreferrer" class="footer-social-link" aria-label="Harish Kumar on GitHub">
                  ${ICONS.github}
                  <span>GitHub</span>
                </a>
              </li>
              <li>
                <a href="${config.linkedin}" target="_blank" rel="noopener noreferrer" class="footer-social-link" aria-label="Harish Kumar on LinkedIn">
                  ${ICONS.linkedin}
                  <span>LinkedIn</span>
                </a>
              </li>
              <li>
                <a href="mailto:${emailAddress}" class="footer-social-link" aria-label="Send email to Harish Kumar">
                  ${ICONS.email}
                  <span>${emailAddress}</span>
                </a>
              </li>
              <li>
                <a href="${config.repo}" target="_blank" rel="noopener noreferrer" class="footer-star-link" aria-label="Star LeetMatric on GitHub">
                  ${ICONS.star}
                  <span>Star on GitHub</span>
                </a>
              </li>
            </ul>
          </div>
        </div>

        <!-- Bottom Bar -->
        <div class="footer-bottom">
          <div class="footer-bottom-info">
            <div class="footer-copyright">
              &copy; ${currentYear} ${config.name}. All rights reserved.
            </div>
            <div class="footer-tech">${config.techStack}</div>
          </div>
          <p class="footer-disclaimer-text">${config.disclaimer}</p>
        </div>
      </div>
    `;
  }

  function mountFooter() {
    let footerEl = document.querySelector("footer.site-footer") || document.querySelector("footer.app-footer");

    if (footerEl) {
      footerEl.className = "app-footer site-footer";
      footerEl.setAttribute("role", "contentinfo");
      footerEl.innerHTML = buildFooterHTML();
    } else {
      footerEl = document.createElement("footer");
      footerEl.className = "app-footer site-footer";
      footerEl.setAttribute("role", "contentinfo");
      footerEl.innerHTML = buildFooterHTML();

      const pageWrapper = document.querySelector(".page-wrapper");
      if (pageWrapper) {
        pageWrapper.appendChild(footerEl);
      } else {
        document.body.appendChild(footerEl);
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountFooter);
  } else {
    mountFooter();
  }
})();
