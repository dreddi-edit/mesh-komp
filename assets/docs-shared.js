/* ============================================================
   MESH Knowledge Hub — Shared JS
   Handles: theme sync, scroll-spy, code copy, animations
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initScrollSpy();
  initCodeCopy();
  initAnimations();
});

function initTheme() {
  try {
    const raw = localStorage.getItem("meshAppearance");
    if (raw) {
      const appearance = JSON.parse(raw);
      if (appearance.theme) {
        document.documentElement.dataset.theme = appearance.theme === "dark" ? "dark" : "light";
      }
    }
  } catch (e) {}
}

function initScrollSpy() {
  const links = document.querySelectorAll(".side-nav a");
  const sections = Array.from(links)
    .map(link => {
      const id = link.getAttribute("href").substring(1);
      return document.getElementById(id);
    })
    .filter(Boolean);

  if (!sections.length) return;

  const observerOptions = {
    threshold: 0.2,
    rootMargin: "-10% 0px -70% 0px"
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute("id");
        links.forEach(link => {
          link.classList.toggle("active", link.getAttribute("href") === "#" + id);
        });
      }
    });
  }, observerOptions);

  sections.forEach(s => observer.observe(s));
}

function initCodeCopy() {
  document.querySelectorAll(".code-copy").forEach(btn => {
    btn.addEventListener("click", () => {
      const wrapper = btn.closest(".code-wrap");
      if (!wrapper) return;
      const pre = wrapper.querySelector(".code-pre");
      if (!pre) return;

      navigator.clipboard.writeText(pre.textContent).then(() => {
        const originalText = btn.textContent;
        btn.textContent = "Copied!";
        btn.style.borderColor = "var(--primary)";
        btn.style.color = "var(--primary)";
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.borderColor = "";
          btn.style.color = "";
        }, 2000);
      });
    });
  });
}

function initAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        // For our CSS, we use .animate as the base and .animate.visible will then trigger
        entry.target.style.opacity = "1";
        entry.target.style.transform = "none";
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll(".animate").forEach(el => observer.observe(el));
}
