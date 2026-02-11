/* ============================================
   MSFG Dashboard - Investors Module
   Investor information, modal, and admin management
   Step 4/5 compatible (dispatcher + a11y)
============================================ */

const Investors = {
  currentInvestorId: null,
  editMode: false,

  // =========================================================
  // INVESTOR DATA
  // Keys match the data-investor="" attributes used in HTML.
  // =========================================================
  data: {
    '5th-street-capital': {
      name: '5th Street Capital',
      accountExecutive: { name: 'Jaime Pierce', email: 'j.pierce@5thstcap.com', mobile: null },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'a-mortgage-boutique': {
      name: 'A Mortgage Boutique',
      accountExecutive: { name: 'John Purchio', email: 'John.Purchio@amortgageboutique.com', mobile: '925-788-6998' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'ad-mortgage': {
      name: 'AD Mortgage',
      accountExecutive: { name: 'Cari Smith', email: 'cari.smith@admortgage.com', mobile: '303-358-5122' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 25000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'acc-mortgage': {
      name: 'ACC Mortgage',
      accountExecutive: { name: 'Debra Santeufemio', email: 'deb.santeufemio@accmortgage.com', mobile: '240.357.8223' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'acra-lending': {
      name: 'Acra Lending',
      accountExecutive: { name: 'Eric Do', email: 'Eric.Do@acralending.com', mobile: '478-461-4287' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'ahl-funding': {
      name: 'AHL Funding',
      accountExecutive: { name: 'Henry Liner', email: 'henry.liner@ahlmail.com', mobile: '(440) 567-3029' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'amwest': {
      name: 'AmWest',
      accountExecutive: { name: 'Christian Kim', email: 'christian.kim@amwestfunding.com', mobile: '714-831-3251' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'anchor-loans': {
      name: 'Anchor Loans',
      accountExecutive: { name: 'Tim Cheatham', email: 'timc@anchorloans.com', mobile: '805-724-3180' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'angel-oak': {
      name: 'Angel Oak',
      accountExecutive: { name: 'Chris Taylor', email: 'chris.taylor@angeloakms.com', mobile: '720-695-9330' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'arc': {
      name: 'ARC',
      accountExecutive: { name: 'Joe Foster', email: 'jfoster@archometpo.com', mobile: '720-560-0496' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'ardri': {
      name: 'ARDRI',
      accountExecutive: { name: 'Erika Kelly', email: 'erika@ardri.ai', mobile: '747-238-3514' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'axos': {
      name: 'Axos',
      accountExecutive: { name: 'McKenna Bond', email: 'mbond@axosbank.com', mobile: '858-744-8582' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'bluepoint': {
      name: 'Bluepoint Mortgage',
      accountExecutive: { name: 'Matthew Guerra', email: 'mguerra@bluepointmtg.com', mobile: null },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'brokers-advantage': {
      name: 'Brokers Advantage',
      accountExecutive: { name: 'Benjamin Brunner', email: 'bbrunner@brokersadvantagemtg.com', mobile: '630-291-1499' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'brokers-first-funding': {
      name: 'Brokers First Funding',
      accountExecutive: { name: 'Mike Fields', email: 'mfields@bffws.com', mobile: '424-335-7738' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'cardinal': {
      name: 'Cardinal Financial',
      accountExecutive: { name: 'Terri Cutting', email: 'terri.cutting@cardinalfinancial.com', mobile: '480-351-5896' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'carrington': {
      name: 'Carrington Mortgage',
      accountExecutive: { name: 'April Guidetti', email: 'April.Guidetti@carringtonms.com', mobile: '949-413-3782' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'celtic-bank': {
      name: 'Celtic Bank',
      accountExecutive: { name: 'Pamela Borough', email: 'pamela.borough@celticloan.com', mobile: '858-776-5947' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'change-wholesale': {
      name: 'Change Wholesale',
      accountExecutive: { name: 'Clark Knoblock', email: 'Clark.Knoblock@changewholesale.com', mobile: '818-612-7246' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'civic': {
      name: 'Civic',
      accountExecutive: { name: 'Steven Weinstock', email: 'steven.weinstock@civicfs.com', mobile: '818-937-0908' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'click-n-close': {
      name: 'Click n Close',
      accountExecutive: { name: 'Brett Barnett', email: 'brett.barnett@clicknclose.com', mobile: 'Office 563-332-2529 / Cell 563-271-4087' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'cmg': {
      name: 'CMG',
      accountExecutive: { name: 'James Manero', email: 'jmanero@cmgfi.com', mobile: '301-339-6722' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'deephaven': {
      name: 'Deephaven',
      accountExecutive: { name: 'Jimmy Smith', email: 'jsmith@deephavenmortgage.com', mobile: 'Direct 704-709-0281 / Mobile 303-909-8225' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'e2': {
      name: 'E2 / First State Bank',
      accountExecutive: { name: null, email: null, mobile: null },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'epm': {
      name: 'EPM',
      accountExecutive: { name: 'Ray Kopitsch', email: 'rkopitsch@epm.net', mobile: '906-440-0178' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'far': {
      name: 'Finance of America Reverse',
      accountExecutive: { name: 'Sheila Lancaster & Nicole Holman', email: 'slancaster@far.com, nholman@far.com', mobile: 'SL: 678-317-4033 / NH: 631-622-4512 / NH cell: 404-563-5729' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'fnba': {
      name: 'First National Bank of America',
      accountExecutive: { name: 'Eric Martin', email: 'eric.martin@fnba.com', mobile: '517-679-6518' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'freedom': {
      name: 'Freedom Mortgage',
      accountExecutive: { name: 'Neiko Basile', email: 'neiko.basile@freedommortgage.com', mobile: '310-871-5923' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'fund-loans': {
      name: 'Fund Loans',
      accountExecutive: { name: 'Zachary Burch', email: 'zburch@fundloans.com', mobile: '760-688-7456' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'giant-lending': {
      name: 'Giant Lending',
      accountExecutive: { name: 'Michael Cleary', email: 'mcleary@thegiantlending.com', mobile: '714-348-8149' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'homebridge': {
      name: 'Homebridge Wholesale',
      accountExecutive: { name: 'Dana Gibson', email: 'dgibson@homebridge.com', mobile: '619-251-6139' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'homelight': {
      name: 'HomeLight',
      accountExecutive: { name: 'TJ Sims', email: 'tj.sims@homelight.com', mobile: '480-864-0861' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'homexpress': {
      name: 'HomeXpress',
      accountExecutive: { name: 'Chad Curley', email: 'ccurley@homexmortgage.com', mobile: '719-487-5021' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'instalend': {
      name: 'InstaLend',
      accountExecutive: { name: 'Sohin Shah', email: 'sohin.shah@instalend.com', mobile: '917-435-5308' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'interfirst': {
      name: 'Interfirst',
      accountExecutive: { name: 'Dee Morelli', email: 'dmorelli@interfirst.com', mobile: 'O: 847-999-3198 / C: 630-956-0133' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'jet-mortgage': {
      name: 'Jet Mortgage',
      accountExecutive: { name: 'Yvonne Acosta', email: 'yvonne.acosta@jetmortgage.com', mobile: '714-673-6647' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'jmac': {
      name: 'JMAC Lending',
      accountExecutive: { name: 'Michael Martin', email: 'michael.martin@jmaclending.com', mobile: '949-390-2630' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'keystone': {
      name: 'Keystone Funding',
      accountExecutive: { name: 'Ralph Hartwig', email: 'rhartwig@keystonefunding.com', mobile: '303-324-0098' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'kind-lending': {
      name: 'Kind Lending',
      accountExecutive: { name: 'Michael Carew', email: 'mcarew@kindlending.com', mobile: '858-248-1273' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'knock': {
      name: 'Knock',
      accountExecutive: { name: 'Tammie Brethower', email: 'tammie@knock.com', mobile: null },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'land-home': {
      name: 'Land Home Financial Services',
      accountExecutive: { name: 'Ray Munnings', email: 'Ray.Munnings@lhfs.com', mobile: '303-304-2576' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'lead-funding': {
      name: 'Lead Funding',
      accountExecutive: { name: 'Jason Richards', email: 'jason@leadfunding.com', mobile: '720-789-7632' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'lend-sure': {
      name: 'Lend Sure (Non-QM)',
      accountExecutive: { name: 'Phil Garonzik', email: 'pgaronzik@lendsure.com', mobile: '720-304-5082' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'lendz': {
      name: 'Lendz Financial',
      accountExecutive: { name: 'Aaron Easton', email: 'aaron.easton@lendzfinancial.com', mobile: '720-304-5082' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'lima-one': {
      name: 'Lima One Capital',
      accountExecutive: { name: 'Devin Stewart', email: 'dstewart@limaone.com', mobile: '714-767-6939' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'loanstream': {
      name: 'LoanStream',
      accountExecutive: { name: 'Laurie Simmons', email: 'lsimmons@lsmortgage.com', mobile: '864-249-4932' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'logan-finance': {
      name: 'Logan Finance',
      accountExecutive: { name: 'Jamie Lokan', email: 'jlokan@loganfinance.com', mobile: '918-691-7272' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'mlb': {
      name: 'MLB Wholesale',
      accountExecutive: { name: 'Justin Wolfe', email: 'jwolfe@mlbmortgage.com', mobile: '469-960-4771' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'mutual-of-omaha': {
      name: 'Mutual of Omaha Mortgage',
      accountExecutive: { name: 'John Mertz', email: 'jmertz@mutualmortgage.com', mobile: '908-370-6900' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'newfi': {
      name: 'Newfi Lending',
      accountExecutive: { name: 'Chris Kniker', email: 'ckniker@newfi.com', mobile: '720-708-8967' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'newrez': {
      name: 'NewRez',
      accountExecutive: { name: 'Zachary Carr', email: 'zachary.carr@newrez.com', mobile: '303-437-3021' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'orion': {
      name: 'Orion',
      accountExecutive: { name: 'Dawn McDonald', email: 'dmcdonald@orionlending.com', mobile: '586-382-0130' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'prmg': {
      name: 'PRMG',
      accountExecutive: { name: 'Greg Palas', email: 'gpalas@prmg.net', mobile: '303-947-5244' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'plaza': {
      name: 'Plaza',
      accountExecutive: { name: 'Todd Biddison', email: 'todd.biddison@plazahomemortgage.com', mobile: '515-360-3722' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'principle': {
      name: 'Principle Lending',
      accountExecutive: { name: 'John Mertz', email: 'jmertz@principlelending.com', mobile: 'O: 303-597-0440 Ext 2311 / C: 970-222-8170' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'provident': {
      name: 'Provident',
      accountExecutive: { name: 'Kim Jordan', email: 'kjordan@provident.com', mobile: '720-708-8967' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'supreme': {
      name: 'Supreme Lending',
      accountExecutive: { name: 'Bob Orban', email: 'Bob.Orban@SupremeLending.com', mobile: '412-278-5974' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'the-lender': {
      name: 'the Lender',
      accountExecutive: { name: 'Patty Lee', email: 'plee@thelender.com', mobile: '303-250-6731' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'the-loan-store': {
      name: 'The Loan Store',
      accountExecutive: { name: 'Sean Cartaya', email: 'scartaya@theloanstore.com', mobile: '949-266-0693' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'towne': {
      name: 'Towne Mortgage Company',
      accountExecutive: { name: 'Ryan Lopez', email: 'rlopez@townemortgage.com', mobile: '702-427-7553' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'triad': {
      name: 'TRIAD',
      accountExecutive: { name: 'Brady Way', email: 'bway@triadfs.com', mobile: '248-921-6115' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'union-home': {
      name: 'Union Home Mortgage',
      accountExecutive: { name: 'Burdette Baker', email: 'bbaker@uhm.com', mobile: '913-620-8131' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'uwm': {
      name: 'UWM',
      accountExecutive: { name: 'Rocky Lund', email: 'rlund@uwm.com', mobile: '330-398-0985' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'village-capital': {
      name: 'Village Capital',
      accountExecutive: { name: 'Robert Little', email: 'rolittle@villagecapital.com', mobile: '800-981-8898 x3496' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'windsor': {
      name: 'Windsor Mortgage',
      accountExecutive: { name: 'Mariah Jorgensen', email: 'mjorgensen@windsormortgage.com', mobile: '801-604-2364' },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    // Placeholder entries for existing dropdown items not in JSON
    'flagstar': {
      name: 'Flagstar',
      accountExecutive: { name: null, email: null, mobile: null },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'homepoint': {
      name: 'Homepoint',
      accountExecutive: { name: null, email: null, mobile: null },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'kirkwood': {
      name: 'Kirkwood',
      accountExecutive: { name: null, email: null, mobile: null },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    },
    'amerihome': {
      name: 'AmeriHome',
      accountExecutive: { name: null, email: null, mobile: null },
      states: null, bestPrograms: null, minimumFico: null, inHouseDpa: null,
      epo: null, maxComp: 18000, docReviewForWireRelease: null, remoteClosingReview: null,
      websiteUrl: null, notes: ''
    }
  },

  // =========================================================
  // FIELD DEFINITIONS (ordered as requested)
  // =========================================================
  fieldDefs: [
    { key: 'name',                    label: 'Investor',                   type: 'text',     required: true },
    { key: 'ae_name',                 label: 'Account Exec',               type: 'text' },
    { key: 'ae_email',                label: 'AE Email',                   type: 'email' },
    { key: 'ae_phone',                label: 'AE Phone',                   type: 'tel' },
    { key: 'states',                  label: 'States',                     type: 'text' },
    { key: 'bestPrograms',            label: 'Best Programs',              type: 'text' },
    { key: 'minimumFico',             label: 'Minimum FICO',               type: 'text' },
    { key: 'inHouseDpa',              label: 'In-house DPA',               type: 'text' },
    { key: 'epo',                     label: 'EPO',                        type: 'text' },
    { key: 'maxComp',                 label: 'Max Comp',                   type: 'number' },
    { key: 'docReviewForWireRelease', label: 'Doc Review for Wire Release',type: 'text' },
    { key: 'remoteClosingReview',     label: 'Remote Closing Review',      type: 'text' },
    { key: 'websiteUrl',              label: 'Link to Website',            type: 'url' },
    { key: 'notes',                   label: 'Notes',                      type: 'textarea' }
  ],

  init() {
    this.bindModalClose();
    this.bindCompanyContactsModalClose();
    this.bindGlobalEscapeClose();
    console.log('Investors module initialized (' + Object.keys(this.data).length + ' investors loaded)');
  },

  // =========================================================
  // HELPERS
  // =========================================================

  /** Generate a URL-safe slug from an investor name */
  slugify(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  },

  /** Return a flat form-ready object for a given investor key (or blank for new) */
  getFormValues(key) {
    const inv = key ? this.data[key] : null;
    const ae = inv?.accountExecutive || {};
    return {
      name:                    inv?.name || '',
      ae_name:                 ae.name || '',
      ae_email:                ae.email || '',
      ae_phone:                ae.mobile || '',
      states:                  inv?.states || '',
      bestPrograms:            inv?.bestPrograms || '',
      minimumFico:             inv?.minimumFico || '',
      inHouseDpa:              inv?.inHouseDpa || '',
      epo:                     inv?.epo || '',
      maxComp:                 inv?.maxComp ?? '',
      docReviewForWireRelease: inv?.docReviewForWireRelease || '',
      remoteClosingReview:     inv?.remoteClosingReview || '',
      websiteUrl:              inv?.websiteUrl || '',
      notes:                   inv?.notes || ''
    };
  },

  /** Apply form values back to local data */
  applyFormValues(key, vals) {
    if (!this.data[key]) {
      this.data[key] = {};
    }
    const inv = this.data[key];
    inv.name                    = vals.name;
    inv.accountExecutive        = {
      name:   vals.ae_name   || null,
      email:  vals.ae_email  || null,
      mobile: vals.ae_phone  || null
    };
    inv.states                  = vals.states || null;
    inv.bestPrograms            = vals.bestPrograms || null;
    inv.minimumFico             = vals.minimumFico || null;
    inv.inHouseDpa              = vals.inHouseDpa || null;
    inv.epo                     = vals.epo || null;
    inv.maxComp                 = vals.maxComp ? Number(vals.maxComp) : null;
    inv.docReviewForWireRelease = vals.docReviewForWireRelease || null;
    inv.remoteClosingReview     = vals.remoteClosingReview || null;
    inv.websiteUrl              = vals.websiteUrl || null;
    inv.notes                   = vals.notes || '';
  },

  // =========================================================
  // Global ESC handler
  // =========================================================
  bindGlobalEscapeClose() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;

      // Close manage modal first if open
      const manage = document.getElementById('manageInvestorsModal');
      if (manage && manage.classList.contains('active')) {
        this.hideManageModal();
        return;
      }

      // Close contacts first if open
      const contacts = document.getElementById('companyContactsModal');
      if (contacts && contacts.classList.contains('active')) {
        this.hideCompanyContactsModal();
        return;
      }

      // Then investor modal
      const investorModal = document.getElementById('investorModal');
      if (investorModal && investorModal.classList.contains('active')) {
        this.hideModal();
      }
    });
  },

  // =========================================================
  // Investor detail modal open/close
  // =========================================================
  bindModalClose() {
    const modal = document.getElementById('investorModal');
    if (!modal) return;

    const closeBtn = modal.querySelector('.modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.hideModal());

    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.hideModal();
    });
  },

  showModal(investorId) {
    const investor = this.data[investorId];
    if (!investor) {
      console.warn('Investor not found:', investorId);
      return;
    }

    const modal = document.getElementById('investorModal');
    if (!modal) {
      console.error('Investor modal element not found (id="investorModal")');
      return;
    }

    this.currentInvestorId = investorId;
    this.editMode = false;

    this.populateModal(investor);
    this.bindSettingsButton();
    this.bindEditFunctionality();

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    setTimeout(() => {
      const content = modal.querySelector('.modal-content');
      if (content) content.style.transform = 'scale(1) translateY(0)';
    }, 10);
  },

  hideModal() {
    const modal = document.getElementById('investorModal');
    if (!modal) return;

    const content = modal.querySelector('.modal-content');
    if (content) content.style.transform = 'scale(0.95) translateY(20px)';

    setTimeout(() => {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }, 200);
  },

  populateModal(investor) {
    const modal = document.getElementById('investorModal');
    if (!modal) return;

    const esc = typeof Utils !== 'undefined' && Utils.escapeHtml
      ? Utils.escapeHtml.bind(Utils)
      : (s) => s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

    // Name
    const nameEl = modal.querySelector('.investor-name');
    if (nameEl) nameEl.textContent = investor.name || 'Investor';

    // Logo
    const logoEl = modal.querySelector('.investor-logo');
    if (logoEl) {
      logoEl.src = investor.logo || '';
      logoEl.alt = investor.name ? investor.name + ' Logo' : 'Investor Logo';
    }

    if (!investor.notes) investor.notes = '';

    // Account Executive
    const aeSection = modal.querySelector('.account-executive');
    if (aeSection) {
      const ae = investor.accountExecutive || {};
      if (ae.name && ae.name !== 'TBD') {
        aeSection.innerHTML =
          '<h4><i class="fas fa-user-tie"></i> Account Executive' +
          '  <button type="button" class="section-edit-btn" data-section="accountExecutive"><i class="fas fa-edit"></i></button>' +
          '</h4>' +
          '<div class="contact-info editable-content">' +
            (ae.name ? '<div contenteditable="true" data-field="name"><strong>' + esc(ae.name) + '</strong></div>' : '') +
            (ae.mobile ? '<div contenteditable="true" data-field="mobile"><i class="fas fa-phone"></i> <a href="tel:' + ae.mobile.replace(/\D/g, '') + '">' + esc(ae.mobile) + '</a></div>' : '') +
            (ae.email ? '<div contenteditable="true" data-field="email"><i class="fas fa-envelope"></i> <a href="mailto:' + ae.email + '">' + esc(ae.email) + '</a></div>' : '') +
            (ae.address ? '<div contenteditable="true" data-field="address"><i class="fas fa-map-marker-alt"></i> ' + esc(ae.address) + '</div>' : '') +
          '</div>';
      } else {
        aeSection.innerHTML =
          '<h4><i class="fas fa-user-tie"></i> Account Executive' +
          '  <button type="button" class="section-edit-btn" data-section="accountExecutive"><i class="fas fa-edit"></i></button>' +
          '</h4>' +
          '<p class="tbd">Information coming soon</p>';
      }
    }

    // Investor details grid (new fields)
    const detailsSection = modal.querySelector('.investor-details');
    if (detailsSection) {
      let html = '<h4><i class="fas fa-info-circle"></i> Investor Details</h4><div class="details-grid">';
      const details = [
        { label: 'States',                    value: investor.states },
        { label: 'Best Programs',             value: investor.bestPrograms },
        { label: 'Minimum FICO',              value: investor.minimumFico },
        { label: 'In-house DPA',              value: investor.inHouseDpa },
        { label: 'EPO',                       value: investor.epo },
        { label: 'Max Comp',                  value: investor.maxComp ? '$' + Number(investor.maxComp).toLocaleString() : null },
        { label: 'Doc Review for Wire Release', value: investor.docReviewForWireRelease },
        { label: 'Remote Closing Review',     value: investor.remoteClosingReview }
      ];
      details.forEach(d => {
        html += '<div class="detail-row">' +
          '<span class="detail-label">' + esc(d.label) + '</span>' +
          '<span class="detail-value">' + (d.value ? esc(String(d.value)) : '<em class="tbd">—</em>') + '</span>' +
        '</div>';
      });
      html += '</div>';
      detailsSection.innerHTML = html;
    }

    // Team
    const teamSection = modal.querySelector('.investor-team');
    if (teamSection) {
      if (Array.isArray(investor.team) && investor.team.length > 0) {
        let teamHtml =
          '<h4><i class="fas fa-users"></i> Meet My Team:' +
          '  <button type="button" class="section-edit-btn" data-section="team"><i class="fas fa-edit"></i></button>' +
          '</h4><div class="team-list editable-content">';
        investor.team.forEach((member) => {
          teamHtml += '<div class="team-member" contenteditable="true">';
          if (member.role) teamHtml += '<strong>' + esc(member.role) + '</strong> / ';
          if (member.name) teamHtml += esc(member.name);
          if (member.phone) teamHtml += ' / <a href="tel:' + member.phone.replace(/\D/g, '') + '">' + esc(member.phone) + '</a>';
          if (member.email) teamHtml += ' / <a href="mailto:' + member.email + '">' + esc(member.email) + '</a>';
          teamHtml += '</div>';
        });
        teamHtml += '</div>';
        teamSection.innerHTML = teamHtml;
      } else {
        teamSection.innerHTML =
          '<h4><i class="fas fa-users"></i> Team' +
          '  <button type="button" class="section-edit-btn" data-section="team"><i class="fas fa-edit"></i></button>' +
          '</h4><p class="tbd">Information coming soon</p>';
      }
    }

    // Lender IDs
    const lenderSection = modal.querySelector('.lender-ids');
    if (lenderSection) {
      const ids = investor.lenderIds || {};
      if (ids.fha || ids.va) {
        lenderSection.innerHTML =
          '<h4><i class="fas fa-id-card"></i> Lender IDs' +
          '  <button type="button" class="section-edit-btn" data-section="lenderIds"><i class="fas fa-edit"></i></button>' +
          '</h4><div class="lender-ids-list editable-content">' +
            (ids.fha ? '<div contenteditable="true" data-field="fha"><strong>FHA:</strong> ' + esc(ids.fha) + '</div>' : '') +
            (ids.va ? '<div contenteditable="true" data-field="va"><strong>VA:</strong> ' + esc(ids.va) + '</div>' : '') +
          '</div>';
      } else {
        lenderSection.innerHTML =
          '<h4><i class="fas fa-id-card"></i> Lender IDs' +
          '  <button type="button" class="section-edit-btn" data-section="lenderIds"><i class="fas fa-edit"></i></button>' +
          '</h4><p class="tbd">Information coming soon</p>';
      }
    }

    // Mortgagee Clause
    const clauseSection = modal.querySelector('.mortgagee-clause');
    if (clauseSection) {
      const mc = investor.mortgageeClause || {};
      if (mc.name) {
        clauseSection.innerHTML =
          '<h4><i class="fas fa-file-contract"></i> Mortgagee Clauses' +
          '  <button type="button" class="section-edit-btn" data-section="mortgageeClause"><i class="fas fa-edit"></i></button>' +
          '</h4><div class="clause-info editable-content">' +
            '<div contenteditable="true" data-field="name"><strong>' + esc(mc.name) + '</strong></div>' +
            (mc.isaoa ? '<div contenteditable="true" data-field="isaoa">' + esc(mc.isaoa) + '</div>' : '') +
            (mc.address ? '<div contenteditable="true" data-field="address">' + esc(mc.address) + '</div>' : '') +
          '</div>';
      } else {
        clauseSection.innerHTML =
          '<h4><i class="fas fa-file-contract"></i> Mortgagee Clauses' +
          '  <button type="button" class="section-edit-btn" data-section="mortgageeClause"><i class="fas fa-edit"></i></button>' +
          '</h4><p class="tbd">Information coming soon</p>';
      }
    }

    // Links
    const linksSection = modal.querySelector('.investor-links');
    if (linksSection) {
      const links = investor.links || {};
      let linksHtml =
        '<h4><i class="fas fa-link"></i> Resources' +
        '  <button type="button" class="section-edit-btn" data-section="links"><i class="fas fa-edit"></i></button>' +
        '</h4><div class="links-list">';

      if (investor.websiteUrl && investor.websiteUrl !== '#') {
        linksHtml += '<a href="' + investor.websiteUrl + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-globe"></i> Website</a>';
      }
      if (investor.loginUrl && investor.loginUrl !== '#') {
        linksHtml += '<a href="' + investor.loginUrl + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-sign-in-alt"></i> Login</a>';
      }
      if (links.website) linksHtml += '<a href="' + links.website + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-globe"></i> Main Website</a>';
      if (links.flexSite) linksHtml += '<a href="' + links.flexSite + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-laptop"></i> Flex Site</a>';
      if (links.faq) linksHtml += '<a href="' + links.faq + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-question-circle"></i> FAQs</a>';
      if (links.appraisalVideo) linksHtml += '<a href="' + links.appraisalVideo + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-video"></i> Ordering Appraisals</a>';
      if (links.newScenarios) linksHtml += '<a href="' + links.newScenarios + '" class="link-item"><i class="fas fa-envelope"></i> New Scenarios</a>';
      if (links.login && links.login !== investor.loginUrl) linksHtml += '<a href="' + links.login + '" target="_blank" rel="noopener noreferrer" class="link-item"><i class="fas fa-sign-in-alt"></i> Login Portal</a>';

      linksHtml += '</div>';
      linksSection.innerHTML = linksHtml;
    }

    // Notes
    const notesSection = modal.querySelector('.investor-notes .notes-content');
    if (notesSection) {
      notesSection.textContent = investor.notes || '';
      if (!investor.notes) notesSection.classList.add('empty');
      else notesSection.classList.remove('empty');
    }
  },

  // =========================================================
  // Settings / edit hooks
  // =========================================================
  bindSettingsButton() {
    const settingsBtn = document.querySelector('.investor-settings-btn');
    if (!settingsBtn) return;

    settingsBtn.onclick = (e) => {
      e.stopPropagation();
      this.toggleEditMode();

      const editBtns = document.querySelectorAll('.section-edit-btn');
      editBtns.forEach((btn) => {
        btn.style.opacity = this.editMode ? '1' : '';
      });
    };
  },

  bindEditFunctionality() {
    document.querySelectorAll('.section-edit-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const section = e.target.closest('[data-section]');
        if (section) this.editSection(section.dataset.section);
      });
    });

    const notesContent = document.querySelector('.notes-content');
    if (notesContent) {
      notesContent.addEventListener('blur', () => this.saveNotes());
      notesContent.addEventListener('input', () => notesContent.classList.remove('empty'));
      notesContent.addEventListener('focus', (e) => {
        if (e.target.classList.contains('empty')) {
          e.target.textContent = '';
          e.target.classList.remove('empty');
        }
      });
    }
  },

  toggleEditMode() {
    this.editMode = !this.editMode;
    const modal = document.getElementById('investorModal');
    if (modal) modal.classList.toggle('edit-mode', this.editMode);
  },

  editSection(sectionName) {
    const section = document.querySelector('[data-section="' + sectionName + '"]');
    if (!section) return;

    const content = section.querySelector('.editable-content, .contact-info, .team-list, .lender-ids-list, .clause-info, .links-list');
    if (!content) return;

    content.contentEditable = true;
    content.focus();

    content.addEventListener('blur', () => {
      this.saveSection(sectionName);
    }, { once: true });
  },

  async saveNotes() {
    if (!this.currentInvestorId) return;

    const notesContent = document.querySelector('.notes-content');
    if (!notesContent) return;

    const notes = notesContent.textContent.trim();

    try {
      await ServerAPI.updateInvestor(this.currentInvestorId, { notes });

      if (this.data[this.currentInvestorId]) {
        this.data[this.currentInvestorId].notes = notes;
      }
    } catch (error) {
      console.error('Failed to save notes:', error);
      if (Utils.setStorage) Utils.setStorage('investor_notes_' + this.currentInvestorId, notes);
    }
  },

  saveSection(sectionName) {
    console.log('Saving section: ' + sectionName);
  },

  // =========================================================
  // Company Contacts modal
  // =========================================================
  bindCompanyContactsModalClose() {
    const modal = document.getElementById('companyContactsModal');
    if (!modal) return;

    const closeBtn = modal.querySelector('.contacts-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.hideCompanyContactsModal());

    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.hideCompanyContactsModal();
    });
  },

  showCompanyContactsModal() {
    const modal = document.getElementById('companyContactsModal');
    if (!modal) {
      console.error('Company contacts modal element not found (id="companyContactsModal")');
      return;
    }

    this.hideModal();

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    setTimeout(() => {
      const content = modal.querySelector('.modal-content');
      if (content) content.style.transform = 'scale(1) translateY(0)';
    }, 10);
  },

  hideCompanyContactsModal() {
    const modal = document.getElementById('companyContactsModal');
    if (!modal) return;

    const content = modal.querySelector('.modal-content');
    if (content) content.style.transform = 'scale(0.95) translateY(20px)';

    setTimeout(() => {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }, 200);
  },

  // =========================================================
  // ADMIN: Manage Investors Modal
  // =========================================================
  _manageSearchTerm: '',
  _editingKey: null,       // null = new investor, string = editing existing

  showManageModal() {
    const modal = document.getElementById('manageInvestorsModal');
    if (!modal) { console.error('manageInvestorsModal not found'); return; }

    this._manageSearchTerm = '';
    this._editingKey = null;
    this._renderManageList();
    this._showManageView('list');

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      const c = modal.querySelector('.modal-content');
      if (c) c.style.transform = 'scale(1) translateY(0)';
    }, 10);
  },

  hideManageModal() {
    const modal = document.getElementById('manageInvestorsModal');
    if (!modal) return;
    const c = modal.querySelector('.modal-content');
    if (c) c.style.transform = 'scale(0.95) translateY(20px)';
    setTimeout(() => {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }, 200);
  },

  /** Toggle between 'list' and 'form' views inside the manage modal */
  _showManageView(view) {
    const listView = document.getElementById('manageInvestorsList');
    const formView = document.getElementById('manageInvestorForm');
    if (!listView || !formView) return;

    if (view === 'form') {
      listView.style.display = 'none';
      formView.style.display = 'block';
    } else {
      listView.style.display = 'block';
      formView.style.display = 'none';
    }
  },

  /** Render the investor list table inside the manage modal */
  _renderManageList() {
    const container = document.getElementById('manageInvestorsTableBody');
    if (!container) return;

    const search = this._manageSearchTerm.toLowerCase();
    const sorted = Object.entries(this.data)
      .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));

    let html = '';
    let count = 0;
    sorted.forEach(([key, inv]) => {
      const name = inv.name || key;
      const ae = inv.accountExecutive || {};
      if (search && !name.toLowerCase().includes(search) && !(ae.name || '').toLowerCase().includes(search)) {
        return;
      }
      count++;
      const esc = (s) => (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]);
      html +=
        '<tr>' +
          '<td>' + esc(name) + '</td>' +
          '<td>' + esc(ae.name || '—') + '</td>' +
          '<td>' + esc(ae.email || '—') + '</td>' +
          '<td>' + esc(ae.mobile || '—') + '</td>' +
          '<td class="manage-actions-cell">' +
            '<button type="button" class="btn btn-sm btn-secondary manage-edit-btn" data-key="' + key + '"><i class="fas fa-edit"></i></button> ' +
            '<button type="button" class="btn btn-sm btn-danger manage-delete-btn" data-key="' + key + '"><i class="fas fa-trash"></i></button>' +
          '</td>' +
        '</tr>';
    });

    if (count === 0) {
      html = '<tr><td colspan="5" class="empty-state">No investors found.</td></tr>';
    }

    container.innerHTML = html;

    // Update count
    const countEl = document.getElementById('manageInvestorCount');
    if (countEl) countEl.textContent = count + ' investor' + (count !== 1 ? 's' : '');

    // Bind edit/delete
    container.querySelectorAll('.manage-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => this._openForm(btn.dataset.key));
    });
    container.querySelectorAll('.manage-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => this._deleteInvestor(btn.dataset.key));
    });
  },

  /** Open the add/edit form for an investor */
  _openForm(key) {
    this._editingKey = key || null;
    const vals = this.getFormValues(key);
    const title = document.getElementById('manageFormTitle');
    if (title) title.textContent = key ? 'Edit Investor' : 'Add Investor';

    this.fieldDefs.forEach(def => {
      const input = document.getElementById('inv_' + def.key);
      if (input) input.value = vals[def.key] ?? '';
    });

    this._showManageView('form');
  },

  /** Save the form (create or update) */
  async _saveForm() {
    const vals = {};
    this.fieldDefs.forEach(def => {
      const input = document.getElementById('inv_' + def.key);
      if (input) vals[def.key] = input.value.trim();
    });

    if (!vals.name) {
      alert('Investor name is required.');
      return;
    }

    const key = this._editingKey || this.slugify(vals.name);

    // Apply locally
    this.applyFormValues(key, vals);

    // Persist to backend
    try {
      const payload = {
        investor_key:               key,
        name:                       vals.name,
        account_executive_name:     vals.ae_name || null,
        account_executive_email:    vals.ae_email || null,
        account_executive_mobile:   vals.ae_phone || null,
        states:                     vals.states || null,
        best_programs:              vals.bestPrograms || null,
        minimum_fico:               vals.minimumFico || null,
        in_house_dpa:               vals.inHouseDpa || null,
        epo:                        vals.epo || null,
        max_comp:                   vals.maxComp ? Number(vals.maxComp) : null,
        doc_review_wire:            vals.docReviewForWireRelease || null,
        remote_closing_review:      vals.remoteClosingReview || null,
        website_url:                vals.websiteUrl || null,
        notes:                      vals.notes || null
      };

      if (this._editingKey) {
        await ServerAPI.updateInvestor(key, payload);
      } else {
        await ServerAPI.createInvestor(payload);
      }
      console.log('Investor saved:', key);
    } catch (err) {
      console.error('Failed to persist investor to backend:', err);
      // Data is still saved locally, backend save failed silently
    }

    // Refresh list & go back
    this._renderManageList();
    this._showManageView('list');
    this._refreshDropdown();
  },

  /** Delete an investor (with confirmation) */
  async _deleteInvestor(key) {
    const inv = this.data[key];
    if (!inv) return;

    if (!confirm('Delete investor "' + (inv.name || key) + '"? This cannot be undone.')) return;

    delete this.data[key];

    try {
      await ServerAPI.deleteInvestor(key);
    } catch (err) {
      console.error('Failed to delete investor on backend:', err);
    }

    this._renderManageList();
    this._refreshDropdown();
  },

  /** Refresh the investor dropdown in the nav */
  _refreshDropdown() {
    const container = document.getElementById('investorDropdownList');
    if (!container) return;

    const sorted = Object.entries(this.data)
      .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));

    let html = '<div class="dropdown-header">Wholesale Partners</div>';
    sorted.forEach(([key, inv]) => {
      html += '<button type="button" class="dropdown-item" data-action="open-investor" data-investor="' + key + '">' +
        '<i class="fas fa-building"></i> ' + ((inv.name || key).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))) +
      '</button>';
    });

    container.innerHTML = html;
  }
};

window.Investors = Investors;
