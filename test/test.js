var chai = require('chai');
var expect = chai.expect;
var clone = require('clone');

var Client = require('../lib/checkerboard.js');


describe('Client', function(){
  describe('Utility', function(){
    describe('DiffableStateFactory', function() {

      var DSF;
      var data = {
        'arrayEmpty': [],
        'arrayOfNumbers': [1, 2, 3, 4, 5],
        'arrayOfObjects': [{a:1},{b:2},{c:3}],
        'arrayOfUndefined': [undefined, undefined, undefined, 4, 5, 6],
        'arrayOfNull': [null, null, null, 4, 5, 6],
        'objectEmpty': {},
        'objectWithNumbers': {a:1,b:2,c:3},
        'objectWithArrays': {a:[1,2,3],b:[4,5,6]},
        'objectWithObjects': {a:{x:1},b:{y:2}},
        'objectWithUndefineds': {a:undefined,b:undefined,c:0,d:1},
        'objectWithNulls': {a:null,b:null,c:0,d:1},
        'nullProperty': null,
        'undefinedProperty': undefined,
        'numberProperty': 42,
        'stringProperty': 'hello, world',
      };

      var startTime;
      beforeEach(function() {
        DSF = new Client.Utility.DiffableStateFactory(clone(data));
        //console.time('test time');
      });

      afterEach(function() {
        //console.timeEnd('test time');
      });

      it('returns contents unmodified when no change', function() {
        var merged = DSF().merge();
        expect(merged).to.deep.equal(data);
      });

        describe('Reading and modifying properties', function() {

        it('creates a new array', function() {
          DSF('newArray', []);

          expect(DSF().diff).to.deep.equal({newArray:'__undefined__'});
          expect(DSF().patch).to.deep.equal({newArray:[]});
          expect(DSF('newArray')).to.deep.equal([]);

          var merged = DSF().merge();
          var expected = clone(data);
          expected.newArray = [];
          expect(merged).to.deep.equal(expected);
        });

        it('does not update diff when modifying a new array', function() {
          DSF('newArray', []);
          DSF.newArray(0, 'hello, world');

          expect(DSF().diff).to.deep.equal({newArray:'__undefined__'});
          expect(DSF().patch).to.deep.equal({newArray:['hello, world']});
          expect(DSF('newArray')).to.deep.equal(['hello, world']);

          var merged = DSF().merge();
          var expected = clone(data);
          expected.newArray = ['hello, world'];
          expect(merged).to.deep.equal(expected);
        });

        it('overwrites an empty array', function() {

          DSF('arrayEmpty', [1, 2, 3, 4, 5]);

          expect(DSF().diff).to.deep.equal({arrayEmpty:[]});
          expect(DSF().patch).to.deep.equal({arrayEmpty:{$set:[1, 2, 3, 4, 5]}});
          expect(DSF('arrayEmpty')).to.deep.equal([1, 2, 3, 4, 5]);

          var merged = DSF().merge();
          var expected = clone(data);
          expected.arrayEmpty = [1, 2, 3, 4, 5];

          expect(merged).to.deep.equal(expected);
        });

        it('overwrites a nonempty array', function() {
          DSF('arrayOfNumbers', [6, 7, 8]);

          expect(DSF().diff).to.deep.equal({arrayOfNumbers:[1, 2, 3, 4, 5]});
          expect(DSF().patch).to.deep.equal({arrayOfNumbers:{$set:[6, 7, 8]}});
          expect(DSF('arrayOfNumbers')).to.deep.equal([6, 7, 8]);

          var merged = DSF().merge();
          var expected = clone(data);
          expected.arrayOfNumbers = [6, 7, 8];
          expect(merged).to.deep.equal(expected);
        });

        it('overwrites a single value of an array', function() {
          DSF.arrayOfNumbers(2, 6);

          expect(DSF().diff).to.deep.equal({arrayOfNumbers:[, , 3]});
          expect(DSF().patch).to.deep.equal({arrayOfNumbers:[, , 6]});
          expect(DSF.arrayOfNumbers(2)).to.equal(6);

          var merged = DSF().merge();
          var expected = clone(data);
          expected.arrayOfNumbers[2] = 6;
          expect(merged).to.deep.equal(expected);
        });

        it('overwrites an object in an array', function() {
          DSF.arrayOfObjects(1, {d:4});

          expect(DSF().diff).to.deep.equal({arrayOfObjects:[, {b:2}]});
          expect(DSF().patch).to.deep.equal({arrayOfObjects:[, {$set:{d:4}}]});
          expect(DSF.arrayOfObjects(1)).to.deep.equal({d:4});

          var merged = DSF().merge();
          var expected = clone(data);
          expected.arrayOfObjects[1] = {d:4};
          expect(merged).to.deep.equal(expected);
        });

        it('modifies a property on an object in an array', function() {
          DSF.arrayOfObjects[1]('b', 4)

          expect(DSF().diff).to.deep.equal({arrayOfObjects: [, {b:2}]});
          expect(DSF().patch).to.deep.equal({arrayOfObjects: [, {b:4}]});
          expect(DSF.arrayOfObjects(1)).to.deep.equal({b:4});

          var merged = DSF().merge();
          var expected = clone(data);
          expected.arrayOfObjects[1] = {b:4};
          expect(merged).to.deep.equal(expected);
        });

        it('updates a undefined value of an array', function() {
          DSF.arrayOfUndefined(2, 6);

          expect(DSF().diff).to.deep.equal({arrayOfUndefined:[, , '__undefined__']});
          expect(DSF().patch).to.deep.equal({arrayOfUndefined:[, , 6]});
          expect(DSF.arrayOfUndefined(2)).to.equal(6);

          var merged = DSF().merge();
          var expected = clone(data);
          expected.arrayOfUndefined[2] = 6;
          expect(merged).to.deep.equal(expected);
        });

        it('updates a null value of an array', function() {
          DSF.arrayOfNull(2, 6);

          expect(DSF().diff).to.deep.equal({arrayOfNull:[, , '__null__']});
          expect(DSF().patch).to.deep.equal({arrayOfNull:[, , 6]});
          expect(DSF.arrayOfNull(2)).to.equal(6);

          var merged = DSF().merge();
          var expected = clone(data);
          expected.arrayOfNull[2] = 6;
          expect(merged).to.deep.equal(expected);
        });

        it('sets a value of an array to undefined', function() {
          DSF.arrayOfNumbers(2, undefined);

          expect(DSF().diff).to.deep.equal({arrayOfNumbers:[, , 3]});
          expect(DSF().patch).to.deep.equal({arrayOfNumbers:[, , '__undefined__']});
          expect(DSF.arrayOfNumbers(2)).to.equal(undefined);

          var merged = DSF().merge();
          var expected = clone(data);
          expected.arrayOfNumbers[2] = undefined;
          expect(merged).to.deep.equal(expected);
        });

        it('sets a value of an array to null', function() {
          DSF.arrayOfNumbers(2, null);

          expect(DSF().diff).to.deep.equal({arrayOfNumbers:[, , 3]});
          expect(DSF().patch).to.deep.equal({arrayOfNumbers:[, , '__null__']});
          expect(DSF.arrayOfNumbers(2)).to.equal(null);

          var merged = DSF().merge();
          var expected = clone(data);
          expected.arrayOfNumbers[2] = null;
          expect(merged).to.deep.equal(expected);
        });

        it('resolves changes', function() {
          DSF.arrayOfNumbers(2, 7);
          DSF('numberProperty', 43);

          DSF().resolve();

          expect(DSF().diff).to.deep.equal({});
          expect(DSF().patch).to.deep.equal({});
          expect(DSF.arrayOfNumbers(2)).to.equal(7);
          expect(DSF('arrayOfNumbers')[2]).to.equal(7);
          expect(DSF('numberProperty')).to.equal(43);

          var merged = DSF().merge();
          var expected = clone(data);
          expected.arrayOfNumbers[2] = 7;
          expected.numberProperty = 43;

          expect(merged).to.deep.equal(expected);
        });

        it('applies changes', function() {
          DSF().apply({
            'arrayOfNumbers': [, , 7],
            'numberProperty': 43,
            'newArray': [1, 2, 3]
          });

          DSF().resolve();

          expect(DSF().diff).to.deep.equal({});
          expect(DSF().patch).to.deep.equal({});
          //expect(DSF.arrayOfNumbers(2)).to.equal(7);
          //expect(DSF('arrayOfNumbers')[2]).to.equal(7);
          expect(DSF('numberProperty')).to.equal(43);
          expect(DSF('newArray')).to.deep.equal([1, 2, 3]);

          var merged = DSF().merge();
          var expected = clone(data);
          expected.arrayOfNumbers[2] = 7;
          expected.numberProperty = 43;
          expected.newArray = [1, 2, 3];
          expect(merged).to.deep.equal(expected);
        });
      });
    });
  });
});
