-- Seed: Quick Links for Processing "Other" tab
INSERT INTO processing_links (section_type, name, url, icon, sort_order) VALUES
('quick_links', 'Rescission Calendar', 'https://www.atsdocs.com/rescissioncalendar.aspx', 'fa-calendar-alt', 1),
('quick_links', 'eFax Portal', 'https://myportal.efax.com/login', 'fa-fax', 2),
('quick_links', 'Date Duration Calculator', 'https://www.timeanddate.com/date/duration.html', 'fa-calculator', 3),
('quick_links', 'IBTS (Inspections)', 'https://www.ibts.org/what-we-do', 'fa-hard-hat', 4),
('quick_links', 'TitlePro247', 'https://v3.titlepro247.com/Home?ReturnUrl=%2FAccount%2FIndex&ReturnUrl=%2FAccount%2FIndex', 'fa-file-signature', 5),
('quick_links', '3-Day Rule / TRID Guide', 'https://www.octitle.com/pdf/3DayRuleTRID.pdf', 'fa-file-pdf', 6),
('quick_links', 'HomeWise Docs', 'https://www.homewisedocs.com/', 'fa-file-alt', 7);

-- Seed: Statewide Resources for Processing "Other" tab
INSERT INTO processing_links (section_type, name, url, group_label, notes, sort_order) VALUES
-- Colorado
('statewide', 'CO Dept of Local Affairs - Property Tax', 'https://dpt.colorado.gov/', 'Colorado (CO)', 'Links to all county assessor/treasurer offices', 1),
('statewide', 'Colorado County Assessors Assoc', 'https://coloradoassessors.org/', 'Colorado (CO)', 'Directory of all county assessors', 2),
-- North Dakota
('statewide', 'ND Property Tax Info Portal', 'https://www.stutsmancounty.gov/ndptip/', 'North Dakota (ND)', 'Statewide map for county parcel tax info', 1),
('statewide', 'ND Assessors Network', 'https://www.northdakotaassessors.com/', 'North Dakota (ND)', 'Most counties linked - standardized search', 2),
('statewide', 'ND GIS Hub', 'https://www.gis.nd.gov/', 'North Dakota (ND)', 'Official statewide GIS parcel dataset', 3),
('statewide', 'NDRIN (Recorders Info Network)', 'https://www.ndrin.com/', 'North Dakota (ND)', 'Subscription - recorded docs 2004+', 4),
('statewide', 'Tyler iTax Portal', 'https://itax.tylertech.com/', 'North Dakota (ND)', 'Many ND counties - add county suffix', 5),
-- South Dakota
('statewide', 'SD Property Tax Portal', 'https://sdproptax.info/', 'South Dakota (SD)', 'Statewide property tax info', 1),
('statewide', 'SD Dept of Revenue - County Directors', 'https://dor.sd.gov/government/director-of-equalization/contact-county-directors-of-equalization/', 'South Dakota (SD)', 'All county Directors of Equalization', 2),
('statewide', 'SD County Treasurers Directory', 'https://dor.sd.gov/government/county-treasurers/', 'South Dakota (SD)', 'All county treasurer contacts', 3),
('statewide', 'South Dakota Directors Network', 'https://www.southdakotadirectors.com/', 'South Dakota (SD)', 'Property search for participating counties', 4),
('statewide', 'Beacon (Schneider GIS)', 'https://beacon.schneidercorp.com/', 'South Dakota (SD)', 'Brookings, Codington, Lake, Lincoln, Minnehaha, Union, Yankton', 5),
-- Minnesota
('statewide', 'Minnesota Assessors Portal', 'https://minnesotaassessors.com/', 'Minnesota (MN)', 'Statewide property search - Clay, Goodhue, Lyon, Polk, Steele, Washington', 1),
('statewide', 'MN Dept of Revenue - Property Tax', 'https://www.revenue.state.mn.us/property-tax', 'Minnesota (MN)', 'State property tax info and resources', 2),
('statewide', 'Beacon (Schneider GIS)', 'https://beacon.schneidercorp.com/', 'Minnesota (MN)', 'Blue Earth, Cottonwood, Freeborn, Isanti, Nobles, Pine, Ramsey, Rice, Sherburne, Winona, Wright', 3),
('statewide', 'MN Assn of County Officers', 'https://www.mncounty.org/', 'Minnesota (MN)', 'Directory of all county offices', 4),
('statewide', 'Hennepin County Property Info', 'https://www.hennepin.us/residents/property', 'Minnesota (MN)', 'Largest MN county - comprehensive property database', 5),
-- Michigan
('statewide', 'BS&A Online', 'https://bsaonline.com/', 'Michigan (MI)', 'Most MI counties use this - property search and tax lookup', 1),
('statewide', 'MI Dept of Treasury - Property Tax', 'https://www.michigan.gov/treasury/local/property-tax', 'Michigan (MI)', 'State property tax info and resources', 2),
('statewide', 'MI Assn of County Treasurers', 'https://www.michigantreasurers.org/', 'Michigan (MI)', 'Directory of all county treasurers', 3),
('statewide', 'AccessMyGov.com', 'https://www.accessmygov.com/', 'Michigan (MI)', 'Several MI counties - tax and assessment portal', 4),
('statewide', 'Wayne County Treasurer', 'https://www.waynecounty.com/elected/treasurer/', 'Michigan (MI)', 'Largest MI county, Detroit metro, online tax auction', 5),
-- Illinois
('statewide', 'Cook County Assessor', 'https://www.cookcountyassessor.com/', 'Illinois (IL)', 'Chicago/suburbs - largest IL county, separate system', 1),
('statewide', 'Cook County Treasurer', 'https://www.cookcountytreasurer.com/', 'Illinois (IL)', 'Cook County tax payments and tax cert info', 2),
('statewide', 'IL Property Tax Appeal Board', 'https://www.ptab.illinois.gov/', 'Illinois (IL)', 'State property tax appeal board', 3),
('statewide', 'IL Dept of Revenue - Property Tax', 'https://tax.illinois.gov/localgovernments/property.html', 'Illinois (IL)', 'State property tax resources and forms', 4),
('statewide', 'IL Assn of County Board Members', 'https://www.ilcounty.org/', 'Illinois (IL)', 'Directory of all county offices', 5),
('statewide', 'Devnet GIS/Property Portals', 'https://www.devnetinc.com/', 'Illinois (IL)', 'Several IL counties use Devnet for property search', 6);
