import React from "react";
export default function ProviderBrand({ branding, name, recipient = false }) {
  const b = branding || { name };
  if (!b?.name) return null;
  return (
    <div className="provider-brand">
      {b.logo && (
        <img
          className={`provider-logo provider-logo--${b.shape || "rounded"}`}
          src={b.logo}
          alt={`${b.name} logo`}
        />
      )}
      <div className="provider-brand-copy">
        <span className="provider-brand-label">
          {recipient ? "Request goes to" : "Your business"}
        </span>
        <strong>{b.name}</strong>
        {b.website && (
          <a href={b.website} target="_blank" rel="noopener noreferrer">
            {new URL(b.website).hostname} ↗
          </a>
        )}
        {b.phone && (
          <a
            className="provider-brand-phone"
            href={`tel:${b.phone.replace(/[^\d+]/g, "")}`}
          >
            {b.phone}
          </a>
        )}
        {b.area && <span className="provider-brand-area">{b.area}</span>}
      </div>
    </div>
  );
}
