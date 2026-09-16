import { useState } from "react";
import "./TaxW8BenForm.css";

const initialForm = {
  name: "",
  citizenship: "India",
  residenceAddress: "",
  poBox: "No",
  mailingAddress: "",
  addressLine2: "",
  city: "",
  postalCode: "",
  country: "India",
  province: "",
  tinType: "",
  tin: "",
  foreignTaxId: "",
  foreignTaxIdNotRequired: false,
  reference: "",
  birthDate: "",
  treatyCountry: "India",
  specialRate: "",
  certification: false,
};

const countries = ["India", "United States", "United Kingdom", "Canada"];

function Field({ label, required = false, hint, children, className = "" }) {
  return (
    <div className={`w8ben-row ${className}`}>
      <div className="w8ben-label">
        <span>{label}{required ? <sup>*</sup> : null}</span>
        {hint ? <small>{hint}</small> : null}
      </div>
      <div className="w8ben-control">{children}</div>
    </div>
  );
}

export default function TaxW8BenForm({ onBack, onSubmit }) {
  const [form, setForm] = useState(initialForm);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const requiredComplete = Boolean(
    form.name.trim() && form.citizenship && form.residenceAddress.trim() &&
    form.postalCode.trim() && form.birthDate && form.treatyCountry &&
    form.specialRate.trim() && form.certification
  );

  return (
    <div className="w8ben-page">
      <div className="w8ben-topbar">
        <button type="button" className="w8ben-back" onClick={onBack}>Back</button>
        <button type="button" className="w8ben-review" disabled={!requiredComplete} onClick={() => onSubmit(form)}>Review and Sign</button>
      </div>

      <header className="w8ben-header">
        <h2>Please complete the form W-8BEN</h2>
        <p>From your answers, the W-8BEN form appears to be the appropriate tax document for you.</p>
        <p>You have indicated that you:</p>
        <ul>
          <li>Are an individual</li>
          <li>Are not a U.S. person</li>
          <li>Are not connected with a U.S. trade or business</li>
          <li>Are not acting as an intermediary</li>
          <li>Do not receive payment for personal services performed in the U.S.</li>
        </ul>
        <p>If any answer is incorrect, <button type="button" className="w8ben-inline-link" onClick={onBack}>go back</button> and update your answers.</p>
      </header>

      <section className="w8ben-section">
        <h3>Part I: Identification of beneficial owner</h3>
        <div className="w8ben-fields">
          <Field label="1. Your name" required hint="Use the name associated with your contributor account."><input value={form.name} onChange={(event) => update("name", event.target.value)} /></Field>
          <Field label="2. Country of citizenship" required><select value={form.citizenship} onChange={(event) => update("citizenship", event.target.value)}><option value="">Select country</option>{countries.map((country) => <option key={country}>{country}</option>)}</select></Field>
          <Field label="3. Permanent residence address" required hint="Do not use a P.O. box or an in-care-of address."><input value={form.residenceAddress} onChange={(event) => update("residenceAddress", event.target.value)} /></Field>
          <Field label="Is this a P.O. box or in-care-of address?" required><select value={form.poBox} onChange={(event) => update("poBox", event.target.value)}><option>No</option><option>Yes</option></select></Field>
          <Field label="Mailing Address" hint="Optional when it matches your residence address."><input value={form.mailingAddress} onChange={(event) => update("mailingAddress", event.target.value)} /></Field>
          <Field label="Address line 2 (Apartment #, street #)"><input value={form.addressLine2} onChange={(event) => update("addressLine2", event.target.value)} /></Field>
          <Field label="City"><input value={form.city} onChange={(event) => update("city", event.target.value)} /></Field>
          <Field label="Postal/Zip code" required><input value={form.postalCode} onChange={(event) => update("postalCode", event.target.value)} /></Field>
          <Field label="Country"><select value={form.country} onChange={(event) => update("country", event.target.value)}>{countries.map((country) => <option key={country}>{country}</option>)}</select></Field>
          <Field label="Province"><input value={form.province} onChange={(event) => update("province", event.target.value)} /></Field>
          <Field label="5. U.S. taxpayer identification number, if required" hint="Enter an ITIN or SSN only if you have one."><div className="w8ben-inline-controls"><label><input type="radio" name="tin-type" checked={form.tinType === "ITIN"} onChange={() => update("tinType", "ITIN")} /> ITIN</label><label><input type="radio" name="tin-type" checked={form.tinType === "SSN"} onChange={() => update("tinType", "SSN")} /> SSN</label><input value={form.tin} onChange={(event) => update("tin", event.target.value)} placeholder="XXX-XX-XXXX" /></div></Field>
          <Field label="6. Foreign tax identification number" hint="Use the number issued by your local tax authority."><div className="w8ben-stacked-control"><label><input type="checkbox" checked={form.foreignTaxIdNotRequired} onChange={(event) => update("foreignTaxIdNotRequired", event.target.checked)} /> Check if FTIN is not legally required.</label><input disabled={form.foreignTaxIdNotRequired} value={form.foreignTaxId} onChange={(event) => update("foreignTaxId", event.target.value)} /></div></Field>
          <Field label="7. Reference number(s), if applicable"><input value={form.reference} onChange={(event) => update("reference", event.target.value)} /></Field>
          <Field label="8. Date of birth" required><input type="text" inputMode="numeric" placeholder="MM/DD/YYYY" value={form.birthDate} onChange={(event) => update("birthDate", event.target.value)} /></Field>
        </div>
      </section>

      <section className="w8ben-section">
        <h3>Part II: Claim of Tax Treaty Benefits</h3>
        <div className="w8ben-fields">
          <Field label="9. I certify that the beneficial owner is a resident of" required hint="Within the meaning of the income tax treaty between the U.S. and that country."><select value={form.treatyCountry} onChange={(event) => update("treatyCountry", event.target.value)}>{countries.filter((country) => country !== "United States").map((country) => <option key={country}>{country}</option>)}</select></Field>
          <Field label="10. Special rate and condition" required hint="Describe the treaty article, income type, and requested withholding rate, if applicable."><textarea value={form.specialRate} onChange={(event) => update("specialRate", event.target.value)} placeholder="Example: Article 12(2), royalties, 15% withholding rate." /></Field>
        </div>
      </section>

      <section className="w8ben-section w8ben-certification">
        <h3>Part III: Certification</h3>
        <p>Under penalties of perjury, I declare that I have reviewed this form and, to the best of my knowledge and belief, it is true, correct, and complete. I further certify that:</p>
        <ul>
          <li>I am the beneficial owner, or I am authorized to sign for the beneficial owner, of the income covered by this form.</li>
          <li>The person named in line 1 is not a U.S. person.</li>
          <li>The income is not effectively connected with a U.S. trade or business, or is otherwise covered by an applicable tax treaty.</li>
          <li>The person named in line 1 is a resident of the treaty country listed in line 9, if applicable.</li>
          <li>For broker transactions and barter exchanges, the beneficial owner is an exempt foreign person as defined in the instructions.</li>
          <li>I authorize this form to be provided to any withholding agent that controls, receives, holds, or pays the income covered by this form.</li>
        </ul>
        <label className="w8ben-certify-check"><input type="checkbox" checked={form.certification} onChange={(event) => update("certification", event.target.checked)} /> I certify that I have the capacity to sign for the person identified in line 1 of this form.</label>
      </section>

      <div className="w8ben-topbar w8ben-bottom">
        <button type="button" className="w8ben-back" onClick={onBack}>Back</button>
        <button type="button" className="w8ben-review" disabled={!requiredComplete} onClick={() => onSubmit(form)}>Review and Sign</button>
      </div>
    </div>
  );
}
