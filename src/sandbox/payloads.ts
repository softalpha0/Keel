export interface BorrowerSeed {
  id: string;
  name: string;
  email: string;
  ein: string;
  website: string;
  description: string;
}

export const BORROWERS: BorrowerSeed[] = [
  // Synthetic data only. Valid-format EINs, not real companies.
  {
    id: "kopi",
    name: "Kopi Roasters",
    email: "kopi@example.com",
    ein: "12-3456781",
    website: "https://kopiroasters.example.com",
    description: "Specialty coffee roaster selling roasted beans and brewing equipment online and to cafes.",
  },
  {
    id: "nimbus",
    name: "Nimbus Apparel",
    email: "nimbus@example.com",
    ein: "12-3456782",
    website: "https://nimbusapparel.example.com",
    description: "Direct-to-consumer apparel brand selling clothing and accessories through its online store.",
  },
  {
    id: "ledgerly",
    name: "Ledgerly SaaS",
    email: "ledgerly@example.com",
    ein: "12-3456783",
    website: "https://ledgerly.example.com",
    description: "Subscription accounting software for small businesses, billed monthly and annually.",
  },
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
        business_name_english: b.name,
        business_structure: "COMPANY",
        description_of_goods_or_services: b.description,
        url: b.website,
        contact_number: "+14155550100", operating_country: ["US"], account_usage: { product_reference: ["RECEIVE_TRANSFERS", "GET_PAID", "MAKE_TRANSFERS"], estimated_monthly_revenue: { amount: "50000", currency: "USD" } },
        industry_category_code: industryCategoryCode,
        registration_address: address,
        business_identifiers: [{ type: "EIN", number: b.ein, country_code: "US" }],
      },
      business_person_details: [
        {
          first_name: "Alex",
          last_name: b.name.split(" ")[0],
          email: b.email,
          date_of_birth: "1985-04-12",
          nationality: "US",
          roles: ["DIRECTOR", "BENEFICIAL_OWNER"],
          residential_address: address, identifications: { primary: { identification_type: "PASSPORT", issuing_country_code: "US", passport: { number: "X12345678", effective_at: "2020-01-01", expire_at: "2030-01-01" } } },
        },
      ],
    },
    primary_contact: { email: b.email },
    customer_agreements: { agreed_to_terms_and_conditions: true, agreed_to_data_usage: true },
  };
}

export const usdGlobalAccountBody = (requestId: string) => ({
  request_id: requestId,
  country_code: "US",
  required_features: [{ currency: "USD", transfer_method: "LOCAL" }],
});



