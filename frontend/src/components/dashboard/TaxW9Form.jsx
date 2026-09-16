import { useState } from "react";
import "./TaxW9Form.css";

const initialForm = {
  name: "",
  businessName: "",
  classification: "",
  exemptPayeeCode: "",
  fatcaCode: "",
  mailingAddress: "",
  addressLine2: "",
  city: "",
  postalCode: "",
  country: "India",
  province: "",
  tin: "",
  certifications: [true, false, true, true],
};

function Field({ label, hint, required = false, children }) {
  return (
    <div className="w9-row">
      <div className="w9-label">
        <span>{label}{required ? <sup>*</sup> : null}</span>
        {hint ? <small>{hint}</small> : null}
      </div>
      <div className="w9-control">{children}</div>
    </div>
  );
}

export default function TaxW9Form({ onBack, onSubmit }) {
  const [form, setForm] = useState(initialForm);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateCertification = (index, checked) => setForm((current) => ({
    ...current,
    certifications: current.certifications.map((value, itemIndex) => itemIndex === index ? checked : value),
  }));
  const requiredComplete = Boolean(form.name.trim() && form.classification && form.tin.trim() && form.certifications.every(Boolean));
  const certificationItems = [
    "The number shown on this form is my correct taxpayer identification number (or I am waiting for a number to be issued to me); and",
    "I am not subject to backup withholding because: (a) I am exempt from backup withholding, or (b) I have not been notified by the Internal Revenue Service (IRS) that I am subject to backup withholding as a result of a failure to report all interest or dividends, or (c) the IRS has notified me that I am no longer subject to backup withholding; and",
    "I am a U.S. citizen or other U.S. person (defined below); and",
    "The FATCA code(s) entered on this form (if any) indicating that I am exempt from FATCA reporting is correct.",
  ];

  return (
    <div className="w9-page">
      <div className="w9-topbar"><button type="button" className="w9-back" onClick={onBack}>Back</button><button type="button" className="w9-review" disabled={!requiredComplete} onClick={() => onSubmit(form)}>Review and Sign</button></div>
      <header className="w9-header">
        <p>Based on the information you provided, we determined that form W-9 may be applicable to you.</p>
        <p>You may want to review the <a href="https://www.irs.gov/pub/irs-pdf/fw9.pdf" target="_blank" rel="noreferrer">instructions for the W-9 form</a>. If this is not the correct form for your situation, <button type="button" className="w9-inline-link" onClick={onBack}>go back</button> so we can help you determine which form is right for you.</p>
      </header>
      <section className="w9-section">
        <h2>Identification</h2>
        <div className="w9-fields">
          <Field label="1. Name" required hint="As shown on your income tax return"><input value={form.name} onChange={(event) => update("name", event.target.value)} /><small>The name you provide must match the name on your GFXunlimit account or <a href="/account-settings">learn how to change your name.</a></small></Field>
          <Field label="2. Business name/disregarded entity name, if different from above (optional)" hint="If you have a business name, trade name, DBA name, or disregarded entity name, you may enter it on line 2."><input value={form.businessName} onChange={(event) => update("businessName", event.target.value)} /></Field>
          <Field label="3. Choose appropriate selection for federal tax classification of the person whose name is entered on line 1" required><select value={form.classification} onChange={(event) => update("classification", event.target.value)}><option value="">Select</option><option>Individual/sole proprietor</option><option>C Corporation</option><option>S Corporation</option><option>Partnership</option><option>Trust/estate</option></select></Field>
          <Field label="4. Exempt payee code (if any)" hint="Exemption codes apply only to certain entities, not individuals. See instructions"><input value={form.exemptPayeeCode} onChange={(event) => update("exemptPayeeCode", event.target.value)} /></Field>
          <Field label="Exemption from FATCA reporting code (if any)"><input value={form.fatcaCode} onChange={(event) => update("fatcaCode", event.target.value)} /></Field>
          <Field label="Mailing Address"><input value={form.mailingAddress} onChange={(event) => update("mailingAddress", event.target.value)} /></Field>
          <Field label="Address line 2 (Apartment #, street #)"><input value={form.addressLine2} onChange={(event) => update("addressLine2", event.target.value)} /></Field>
          <Field label="City"><input value={form.city} onChange={(event) => update("city", event.target.value)} /></Field>
          <Field label="Postal/Zip code"><input value={form.postalCode} onChange={(event) => update("postalCode", event.target.value)} /></Field>
          <Field label="Country"><select value={form.country} onChange={(event) => update("country", event.target.value)}><option>India</option><option>United States</option><option>United Kingdom</option><option>Canada</option></select></Field>
          <Field label="Province"><input value={form.province} onChange={(event) => update("province", event.target.value)} /></Field>
        </div>
      </section>
      <section className="w9-section"><h2>Part I: Taxpayer Identification Number (TIN)</h2><div className="w9-fields"><Field label="U.S. Taxpayer identification number" required><input value={form.tin} onChange={(event) => update("tin", event.target.value)} placeholder="XX-XXXXXXX" /></Field></div><p className="w9-note">The TIN provided must match the name given on line 1 to avoid backup withholding. For individuals, this is generally your social security number (SSN). However, for a resident alien, sole proprietor, or disregarded entity, see the instructions for Part I. For other entities, it is your employer identification number (EIN). If you do not have a number, see How to get a TIN. Note: If the account is in more than one name, see the instructions for line 1. Also see What Name and Number To Give the Requester for guidelines on whose number to enter.</p></section>
      <section className="w9-section w9-certification"><h2>Part II: Certification</h2><p>Under penalties of perjury, I certify that:</p>{certificationItems.map((text, index) => <label key={text}><input type="checkbox" checked={form.certifications[index]} onChange={(event) => updateCertification(index, event.target.checked)} /><span>{text}</span></label>)}<p><strong>Certification instructions.</strong> You must uncheck item 2 above if you have been notified by the IRS that you are currently subject to backup withholding because you have failed to report all interest and dividends on your tax return.</p><p>For real estate transactions, item 2 does not apply. For mortgage interest paid, acquisition or abandonment of secured property, cancellation of debt, contributions to an individual retirement arrangement (IRA), and generally, payments other than interest and dividends, you are not required to sign the certification, but you must provide your correct TIN. See the instructions for Part II.</p></section>
      <div className="w9-topbar w9-bottom"><button type="button" className="w9-back" onClick={onBack}>Back</button><button type="button" className="w9-review" disabled={!requiredComplete} onClick={() => onSubmit(form)}>Review and Sign</button></div>
    </div>
  );
}
