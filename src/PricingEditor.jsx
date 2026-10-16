import React, { useState } from "react";
import {
  blankPricing,
  PRICING_METHODS,
  tmPricingSample,
} from "./provider-pricing.js";
import { EstimateInputs, EstimatePreview } from "./PricingEstimate.jsx";
export default function PricingEditor({ config, onChange, disabled = false }) {
  const [area, setArea] = useState("5000"),
    [quantities, setQuantities] = useState({});
  const patch = (value) => onChange({ ...config, ...value });
  const extra = (i, value) =>
    patch({
      extras: config.extras.map((row, j) =>
        j === i ? { ...row, ...value } : row,
      ),
    });
  const tier = (i, value) =>
    patch({
      tiers: config.tiers.map((row, j) =>
        j === i ? { ...row, ...value } : row,
      ),
    });
  const tiered = ["whole", "progressive", "flat"].includes(config.method);
  return (
    <div className="pricing-editor">
      <h3 data-page-section>Rates &amp; tiers</h3>
      <label>
        Currency (ISO code)
        <input
          value={config.currency}
          maxLength={3}
          disabled={disabled}
          onChange={(e) => patch({ currency: e.target.value.toUpperCase() })}
        />
      </label>
      <label>
        Pricing method
        <select
          value={config.method}
          disabled={disabled}
          onChange={(e) => {
            setQuantities({});
            patch({
              method: e.target.value,
              tiers:
                config.tiers?.length >= 2 ? config.tiers : blankPricing().tiers,
            });
          }}
        >
          {Object.entries(PRICING_METHODS).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {config.method === "area" && (
        <label>
          Rate per square foot
          <input
            inputMode="decimal"
            value={config.rate}
            disabled={disabled}
            onChange={(e) => patch({ rate: e.target.value })}
          />
        </label>
      )}
      {tiered && (
        <>
          <p>
            {config.method === "whole"
              ? "One rate applies to the entire property. A lower rate at the next tier can reduce the total."
              : config.method === "progressive"
                ? "Each portion of the property is priced at that band’s rate."
                : "The property’s size selects one fixed project fee."}
          </p>
          <label>
            Number of tiers
            <select
              disabled={disabled}
              value={config.tiers.length}
              onChange={(e) =>
                patch({
                  tiers:
                    Number(e.target.value) === 2
                      ? [config.tiers[0], { ...config.tiers.at(-1), upTo: "" }]
                      : [
                          config.tiers[0],
                          {
                            upTo: String(
                              Number(config.tiers[0].upTo || 5000) + 5000,
                            ),
                            price: config.tiers.at(-1).price,
                          },
                          { ...config.tiers.at(-1), upTo: "" },
                        ],
                })
              }
            >
              <option value="2">Two tiers</option>
              <option value="3">Three tiers</option>
            </select>
          </label>
          {config.tiers.map((row, i) => (
            <fieldset key={i} disabled={disabled}>
              <legend>
                Tier {i + 1} ·{" "}
                {i ? Number(config.tiers[i - 1].upTo || 0) + 1 : 1} sq ft and
                above
              </legend>
              {i < config.tiers.length - 1 ? (
                <label>
                  Upper area limit · tier {i + 1}
                  <input
                    type="number"
                    min="1"
                    max="999999999"
                    step="1"
                    value={row.upTo}
                    onChange={(e) => tier(i, { upTo: e.target.value })}
                  />
                </label>
              ) : (
                <p>No upper area limit.</p>
              )}
              <label>
                {config.method === "flat"
                  ? "Project fee"
                  : "Rate per square foot"}{" "}
                · tier {i + 1}
                <input
                  inputMode="decimal"
                  value={row.price}
                  onChange={(e) => tier(i, { price: e.target.value })}
                />
              </label>
            </fieldset>
          ))}
        </>
      )}
      <h3 data-page-section>Named extras</h3>
      <p>
        Add charges such as editing per hour, travel per visit or a fixed
        delivery fee. Use “item” for a fixed charge with quantity 1.
      </p>
      {config.extras.map((row, i) => (
        <fieldset key={row.id} disabled={disabled}>
          <legend>Extra {i + 1}</legend>
          <div className="pricing-fields">
            <label>
              Extra name · {i + 1}
              <input
                maxLength={80}
                value={row.name}
                onChange={(e) => extra(i, { name: e.target.value })}
              />
            </label>
            <label>
              Price per unit · {i + 1}
              <input
                inputMode="decimal"
                value={row.price}
                onChange={(e) => extra(i, { price: e.target.value })}
              />
            </label>
            <label>
              Unit · {i + 1}
              <input
                maxLength={30}
                placeholder="hour, visit, item…"
                value={row.unit}
                onChange={(e) => extra(i, { unit: e.target.value })}
              />
            </label>
            <label>
              Suggested quantity · {i + 1}
              <input
                inputMode="decimal"
                value={row.defaultQuantity}
                onChange={(e) => extra(i, { defaultQuantity: e.target.value })}
              />
            </label>
            <label>
              Maximum quantity · {i + 1}
              <input
                inputMode="decimal"
                value={row.maxQuantity}
                onChange={(e) => extra(i, { maxQuantity: e.target.value })}
              />
            </label>
          </div>
          <label className="pricing-check">
            <input
              type="checkbox"
              checked={row.required}
              onChange={(e) => extra(i, { required: e.target.checked })}
            />
            Required extra · {i + 1}
          </label>
          <button
            type="button"
            onClick={() => {
              setQuantities({});
              patch({ extras: config.extras.filter((_, j) => j !== i) });
            }}
          >
            Remove extra {i + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={disabled || config.extras.length >= 10}
        onClick={() =>
          patch({
            extras: [
              ...config.extras,
              {
                id: "extra-" + crypto.randomUUID(),
                name: "",
                price: "0",
                unit: "hour",
                required: false,
                defaultQuantity: "1",
                maxQuantity: "100",
              },
            ],
          })
        }
      >
        Add named extra
      </button>
      <h3 data-page-section>Client budgets</h3>
      <label className="pricing-check">
        <input
          type="checkbox"
          disabled={disabled}
          checked={config.allowBudget}
          onChange={(e) => patch({ allowBudget: e.target.checked })}
        />
        Let clients propose a budget
      </label>
      <details>
        <summary>Optional TM sample rates</summary>
        <p>
          Loads Transcendence Media’s sample rates into this unsaved editor.
          Edit them for your business, then publish explicitly. It never changes
          who receives requests.
        </p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setQuantities({});
            onChange(tmPricingSample());
          }}
        >
          Load TM sample into editor
        </button>
      </details>
      <section className="pricing-preview" aria-label="Pricing preview">
        <h3 data-page-section>Try your calculation</h3>
        <p>Preview only. Nothing is submitted, paid or published here.</p>
        <EstimateInputs
          config={config}
          areaLabel="Preview square footage"
          area={area}
          onArea={setArea}
          quantities={quantities}
          onQuantities={setQuantities}
          disabled={disabled}
        />
        <EstimatePreview config={config} area={area} quantities={quantities} />
      </section>
    </div>
  );
}
