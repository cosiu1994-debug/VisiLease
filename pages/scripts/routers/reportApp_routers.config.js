app.config(function ($stateProvider, $urlRouterProvider) {
  $stateProvider
    .state('dealsAnalysis', {
      url: '/dealsAnalysis',
      templateUrl: '../templates/deals_analysis.html',
      controller: 'deals_analysis_controller',
      controllerAs: 'dm'
    }).state('main', {
      url: '/main',
      templateUrl: '../templates/main.html',
      controller: 'ReportController',
      controllerAS: 'vm'
    }).state('unit_source', {
      url: '/unit_source',
      templateUrl: '../templates/units_opreator.html',
      controller: 'UnitOpreatorController',
      controllerAS: 'um'
    }).state('contract_source', {
      url: '/contract_source',
      templateUrl: '../templates/contracts_operator.html',
      controller: 'contracts_controller',
      controllerAS: 'cm'
    }).state('contract_detail', {
      url: '/contract_detail/:id',
      templateUrl: '../templates/contract_detail.html',
      controller: 'contract_detail_controller',
      controllerAs: 'cdm'
    }).state('crm_management', {
      url: '/crm_management',
      templateUrl: '../templates/crm_template.html',
      controller: 'CRMController as ccm'
    }).state('contract_edit', {
      url: '/contract_edit/:id',
      templateUrl: '../templates/contract_edit.html',
      controller: 'contract_edit_controller',
      controllerAs: 'cem',
    })

  $urlRouterProvider.otherwise('/main');
})