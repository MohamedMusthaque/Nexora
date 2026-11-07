$(document).ready(function(){

    $('#categories').on('click', '.btn-categories', function(){

        if (this.id == 'all') {
            $('#parent > div').fadeIn(450);
        } else {
            var $el = $('.' + this.id).fadeIn(450);
            $('#parent > div').not($el).hide();
        }
 
        $("#categories .btn-categories").removeClass("active");
        $(this).addClass('active');

    });

 
    function searchProducts () {        
        $("#categories .btn-categories").removeClass("active");
        var matcher = new RegExp($("#search").val(), 'gi');
        $('.box').show().not(function(){
            return matcher.test($(this).find('.name, .sku').text())
        }).hide();
    }

    let $search = $("#search").on('input',function(){
        searchProducts();       
    });


    $('body').on('click', '#jq-keyboard button', function(e) {
        if($("#search").is(":focus")) {
            searchProducts(); 
        }          
    });


    function searchOpenOrders() {
        var matcher = new RegExp($("#holdOrderInput").val(), 'gi');
        $('.order').show().not(function(){
            return matcher.test($(this).find('.ref_number').text())
        }).hide();

    }

    var $searchHoldOrder = $("#holdOrderInput").on('input',function () {
        searchOpenOrders();
    });


    $('body').on('click', '.holdOrderKeyboard .key', function() {
        if($("#holdOrderInput").is(":focus")) {
            searchOpenOrders(); 
        }          
    });
 
  
    function searchCustomerOrders() {
        var matcher = new RegExp($("#holdCustomerOrderInput").val(), 'gi');
        $('.customer-order').show().not(function(){
            return matcher.test($(this).find('.customer_name').text())
        }).hide();
    }

    var $searchCustomerOrder = $("#holdCustomerOrderInput").on('input',function () {
        searchCustomerOrders();
    });


    $('body').on('click', '.customerOrderKeyboard .key', function() {
        if($("#holdCustomerOrderInput").is(":focus")) {
            searchCustomerOrders();
        }          
    });
 


    var $list = $('.list-group-item').click(function () {
       // disabled options (e.g. Credit for a walk-in customer) can't be selected;
       // the message is shown by the handler in pos.js
       if ($(this).hasClass('disabled')) return;

       $list.removeClass('active');
       $(this).addClass('active');
       if(this.id == 'check'){
            $("#cardInfo").show();
            $("#cardInfo .input-group-addon").text("Check Info");
       }else if(this.id == 'card'){
           $("#cardInfo").show();
           $("#cardInfo .input-group-addon").text("Card Info");
       }
       else if(this.id == 'bank'){
           $("#cardInfo").show();
           $("#cardInfo .input-group-addon").text("Bank Info");
       }
       else if(this.id == 'cash' || this.id == 'credit'){
           $("#cardInfo").hide();
       }
    });


    $.fn.go = function (value,isDueInput) {
        if(isDueInput){
            $("#refNumber").val($("#refNumber").val()+""+value)
        }else{
            $("#payment").val($("#payment").val()+""+value);
            $(this).calculateChange();
        }
    }


    $.fn.digits = function(){
        $("#payment").val($("#payment").val()+".");
        $(this).calculateChange();
    }

    $.fn.calculateChange = function () {
        var payable = parseFloat($("#payablePrice").val()) || 0;   // after any advance used
        var paid = parseFloat($("#payment").val()) || 0;
        var change = payable - paid;                                 // negative = change to give back
        var extra = Math.max(paid - payable, 0);

        // a registered customer paying more than the bill can keep the extra
        // as advance for the next bill instead of taking change (not on Credit)
        var canKeep = !!$("#paymentModel").data("advanceCustomer") && extra > 0.004 && !$("#credit").hasClass("active");
        $("#advanceKeepRow").toggle(canKeep);
        if (!canKeep) $("#keepAsAdvance").prop("checked", false);
        $("#advanceKeepAmount").text(($("#payment_curr").text() || "") + extra.toFixed(2));
        var keep = canKeep && $("#keepAsAdvance").is(":checked");

        // split payment: a registered customer paying part now (Cash / Card /
        // Bank Transfer) can put the rest on their credit
        var short = Math.max(payable - paid, 0);
        var canSplit = !!$("#paymentModel").data("advanceCustomer") && paid > 0.004 && short > 0.004 && !$("#credit").hasClass("active");
        $("#creditRemainderRow").toggle(canSplit);
        if (!canSplit) $("#creditRemainder").prop("checked", false);
        $("#creditRemainderAmount").text(($("#payment_curr").text() || "") + short.toFixed(2));
        var split = canSplit && $("#creditRemainder").is(":checked");

        if(change <= 0){
            $("#change").text(keep ? "0.00" : change.toFixed(2));
        }else{
            $("#change").text('0')
        }
        if(change <= 0 || split){
            $("#confirmPayment").show();
        }else{
            $("#confirmPayment").hide();
        }
    }

})