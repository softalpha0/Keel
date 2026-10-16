/**
 * Request bodies for setting up Kit 7 borrowers as connected accounts.
 *
 * The builder guide fixes the shape (account_details with business_details and
 * business_person_details side by side, an EIN in business_identifiers, account
 * addresses using address_line1/suburb) but not every field name. Anything marked
 * VERIFY should be checked against the airwallex-docs MCP server; if Airwallex
 * rejects a field, `npm run sandbox:setup` prints the exact error and stops.
 */

export interface BorrowerSeed {
  id: string;
  name: string;
  email: string;
  ein: string;
}

export const BORROWERS: BorrowerSeed[] = [
  // Synthetic data only. Valid-format EINs, not real companies.
  { id: "kopi", name: "Kopi Roasters", email: "kopi@example.com", ein: "12-3456781" },
  { id: "nimbus", name: "Nimbus Apparel", email: "nimbus@example.com", ein: "12-3456782" },
  { id: "ledgerly", name: "Ledgerly SaaS", email: "ledgerly@example.com", ein: "12-3456783" },
];

const address = {
  address_line1: "100 Market Street",
  suburb: "San Francisco", // accounts use suburb, not city
  state: "CA",
  postcode: "94105",
  country_code: "US",
};

export function connectedAccountBody(b: BorrowerSeed, industryCategoryCode: string) {
  return {
    account_details: {
      business_details: {
        business_name: b.name,
        business_structure: "COMPANY", // VERIFY
        industry_category_code: industryCategoryCode, // ICCV3_XXXXXX from /reference/industry_categories
        registration_address: address, // VERIFY field name
        business_identifiers: [{ type: "EIN", number: b.ein, country_code: "US" }], // required before submit
      },
      // Include the person at create time: adding one later does not persist.
      business_person_details: [
        {
          first_name: "Alex", // VERIFY person fields
          last_name: b.name.split(" ")[0],
          email: b.email,
          date_of_birth: "1985-04-12",
          nationality: "US",
          roles: ["DIRECTOR", "BENEFICIAL_OWNER"],
          residential_address: address,
        },
      ],
    },
    primary_contact: { email: b.email }, // VERIFY
    customer_agreements: { agreed_to_terms_and_conditions: true, agreed_to_data_usage: true }, // VERIFY
  };
}

export const usdGlobalAccountBody = (requestId: string) => ({
  request_id: requestId,
  country_code: "US",
  required_features: [{ currency: "USD", transfer_method: "LOCAL" }],
});
